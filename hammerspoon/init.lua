-- -*- mode: lua -*-

-- Launch and close apps automatically as matching USB devices appear
-- and disappear. This is useful when a USB hub is powered on after login or
-- disconnected later.

local log = hs.logger.new("usb-launch", "info")

-- Hammerspoon stops watchers and timers when their Lua userdata is garbage
-- collected. Keep every long-lived object reachable from a global table for
-- the lifetime of this Lua environment. A config reload creates a fresh Lua
-- environment and cleans up the old objects automatically.
local runtime = { pendingTimers = {} }
_G.usbAppAutomation = runtime

local function doAfter(delay, callback)
  local timer
  timer = hs.timer.doAfter(delay, function()
    runtime.pendingTimers[timer] = nil
    callback()
  end)
  runtime.pendingTimers[timer] = true
end

-- Kill stale Hammerspoon instances from previous nix store generations.
-- home-manager rebuilds change the .app path (new nix store hash), so macOS
-- treats the new bundle as a different app and launches a second instance
-- alongside the orphaned one. Both would run this init.lua and fight over the
-- same USB/app watchers. Kill any existing instance before setting up ours.
local myBundleID = hs.processInfo.bundleID
local myPID = hs.processInfo.processID
if myBundleID and myPID then
  for _, app in ipairs(hs.application.applicationsForBundleID(myBundleID)) do
    if app:pid() ~= myPID then
      log.w("Killing stale Hammerspoon instance (PID " .. app:pid() .. ")")
      app:kill()
    end
  end
end

local APP_LAUNCH_COOLDOWN_SECONDS = 5

-- Delay after wake before reconciling app state, giving USB devices time to
-- re-enumerate so we don't falsely quit an app whose device is still attaching.
local WAKE_RECONCILE_DELAY_SECONDS = 3
local USB_REMOVAL_RECHECK_DELAY_SECONDS = 1

-- Backstop heartbeat: periodically enforce the invariant that each managed app
-- runs if and only if its USB device is attached. Covers state changes the
-- event watchers cannot see, e.g. a device removed while Hammerspoon was not
-- running (after a reload or relaunch), so no usb-removed event was delivered.
-- It is also how self-quits are detected (see seenRunning below), so an app
-- that quits on its own is left alone from the next heartbeat onwards.
local HEARTBEAT_INTERVAL_SECONDS = 15

-- The Insta360 Link webcam has no rule. The Insta360 Webcam Stream Deck plugin
-- controls it over USB, so Insta360 Link Controller is needed only for firmware
-- updates. See elgato/README.md.
local deviceRules = {
  {
    vendorID = 4057,
    productID = 154,
    launchName = "Elgato Stream Deck",
    bundleID = "com.elgato.StreamDeck",
  },
  {
    vendorID = 4057,
    productID = 154,
    launchName = "Elgato Control Center",
    bundleID = "com.corsair.ControlCenter",
  },
}

local lastLaunchAt = {}

-- Apps that quit on their own while their USB device stayed attached: the user
-- quit them, they crashed, or an updater closed them to install a new version.
-- Keyed by rule.launchName. While an app is suppressed we do not relaunch it,
-- so the quit sticks instead of being undone by the heartbeat or a reconcile.
-- Suppression is cleared when the device is removed or (re-)added, so
-- unplugging/replugging the device brings the app back, and when the app is
-- seen running again (opened by hand or relaunched by its updater), so it is
-- managed normally from then on.
local suppressedApps = {}

-- Apps we saw running at the last check, keyed by rule.launchName. Self-quits
-- are detected by polling, not with hs.application.watcher: macOS posts no
-- NSWorkspace launch/terminate notifications for LSUIElement (menu bar) apps,
-- and both Elgato apps are LSUIElement, so a watcher never sees them quit.
-- Polling in the heartbeat is also the only place a relaunch can originate
-- from, so a quit is always noticed before it could be undone.
local seenRunning = {}

-- Last stable attached/absent state for the USB devices we manage. Wake can
-- trigger USB re-enumeration events, so use this to avoid re-launching apps
-- unless the effective USB state changed while the machine was asleep.
local lastKnownDeviceState = nil
local wakeReconcilePending = false

local function deviceMatchesRule(device, rule)
  return device.vendorID == rule.vendorID and device.productID == rule.productID
end

local function anyConnectedDeviceMatchesRule(rule)
  for _, device in ipairs(hs.usb.attachedDevices() or {}) do
    if deviceMatchesRule(device, rule) then
      return true
    end
  end

  return false
end

-- Bundle IDs remain stable when an app's display/process name changes (e.g.
-- Elgato Control Center now runs as "ControlCenter"), so match on those.
local function runningAppForRule(rule)
  return hs.application.applicationsForBundleID(rule.bundleID)[1]
end

-- Look up the app and compare with the last check. An app that was running and
-- is gone while its device is still attached quit on its own, so suppress its
-- relaunch. An app that is running again is managed normally from now on.
local function observeApp(rule)
  local appName = rule.launchName
  local app = runningAppForRule(rule)

  if app then
    if suppressedApps[appName] then
      log.i(string.format("%s is running again; managing it normally", appName))
      suppressedApps[appName] = nil
    end
    seenRunning[appName] = true
  elseif seenRunning[appName] then
    seenRunning[appName] = nil
    if anyConnectedDeviceMatchesRule(rule) then
      suppressedApps[appName] = true
      log.i(string.format("Suppressing relaunch of %s; it quit while its device stayed attached", appName))
    end
  end

  return app
end

-- A device attach/detach (or a wake-time state change) is an explicit signal:
-- forget any self-quit and manage the app from scratch.
local function resetQuitTracking(rule)
  suppressedApps[rule.launchName] = nil
  seenRunning[rule.launchName] = nil
end

local function launchAppIfNeeded(rule, reason)
  -- Guard every launch path, including USB attach and wake, not just heartbeat.
  -- launchOrFocusByBundleID would otherwise steal focus from a running app.
  if observeApp(rule) then
    return
  end

  local appName = rule.launchName

  if suppressedApps[appName] then
    log.i(string.format("Skipping %s launch; it quit on its own (%s)", appName, reason))
    return
  end

  local now = hs.timer.secondsSinceEpoch()
  local lastLaunch = lastLaunchAt[appName] or 0

  if now - lastLaunch < APP_LAUNCH_COOLDOWN_SECONDS then
    log.i(string.format("Skipping %s launch; cooldown active (%s)", appName, reason))
    return
  end

  lastLaunchAt[appName] = now
  log.i(string.format("Launching %s (%s)", appName, reason))
  if hs.application.launchOrFocusByBundleID(rule.bundleID) then
    -- Count a launch we made as seen, so an app that quits again before the
    -- next heartbeat (e.g. to install an update it found on startup) is
    -- treated as a self-quit rather than launched again.
    seenRunning[appName] = true
  end
end

local function quitAppIfRunning(rule, reason)
  local appName = rule.launchName
  local app = runningAppForRule(rule)
  seenRunning[appName] = nil
  if not app then
    return
  end

  log.i(string.format("Closing %s (%s)", appName, reason))
  app:kill()
end

local function deviceKey(vendorID, productID)
  return string.format("%s:%s", tostring(vendorID), tostring(productID))
end

local function deviceKeyForDevice(device)
  return deviceKey(device.vendorID, device.productID)
end

local function deviceKeyForRule(rule)
  return deviceKey(rule.vendorID, rule.productID)
end

local function matchingRulesForDevice(device)
  local matchingRules = {}

  for _, rule in ipairs(deviceRules) do
    if deviceMatchesRule(device, rule) then
      table.insert(matchingRules, rule)
    end
  end

  return matchingRules
end

local function connectedDeviceState()
  local state = {}

  for _, rule in ipairs(deviceRules) do
    state[deviceKeyForRule(rule)] = false
  end

  for _, device in ipairs(hs.usb.attachedDevices() or {}) do
    for _, rule in ipairs(deviceRules) do
      if deviceMatchesRule(device, rule) then
        state[deviceKeyForRule(rule)] = true
      end
    end
  end

  return state
end

local function deviceStatesMatch(left, right)
  if not left or not right then
    return false
  end

  for _, rule in ipairs(deviceRules) do
    local key = deviceKeyForRule(rule)
    if left[key] ~= right[key] then
      return false
    end
  end

  return true
end

local function handleDeviceEvent(device, eventName)
  local matchingRules = matchingRulesForDevice(device)
  if #matchingRules == 0 then
    return
  end

  local productName = device.productName or ""
  local vendorName = device.vendorName or ""
  local reason = string.format("%s: %s / %s", eventName, vendorName, productName)
  local key = deviceKeyForDevice(device)

  if eventName == "usb-added" then
    if lastKnownDeviceState and lastKnownDeviceState[key] then
      log.i(string.format("Skipping app launch; USB state already connected (%s)", reason))
      return
    end

    for _, rule in ipairs(matchingRules) do
      -- A fresh attach is an explicit signal the user wants the app; undo any
      -- prior self-quit suppression before (re)launching.
      resetQuitTracking(rule)
      launchAppIfNeeded(rule, reason)
    end

    if lastKnownDeviceState then
      lastKnownDeviceState[key] = true
    end
  elseif eventName == "usb-removed" then
    local recheckDelay = USB_REMOVAL_RECHECK_DELAY_SECONDS
    if wakeReconcilePending then
      recheckDelay = WAKE_RECONCILE_DELAY_SECONDS
    end

    doAfter(recheckDelay, function()
      if anyConnectedDeviceMatchesRule(matchingRules[1]) then
        if lastKnownDeviceState then
          lastKnownDeviceState[key] = true
        end
        return
      end

      for _, rule in ipairs(matchingRules) do
        resetQuitTracking(rule)
        quitAppIfRunning(rule, reason)
      end

      if lastKnownDeviceState then
        lastKnownDeviceState[key] = false
      end
    end)
  end
end

-- Enforce the invariant for a single rule: the app runs if and only if its USB
-- device is currently attached.
local function reconcileRule(rule, reason)
  local key = deviceKeyForRule(rule)

  if anyConnectedDeviceMatchesRule(rule) then
    launchAppIfNeeded(rule, reason)
    if lastKnownDeviceState then
      lastKnownDeviceState[key] = true
    end
  else
    resetQuitTracking(rule)
    quitAppIfRunning(rule, reason)
    if lastKnownDeviceState then
      lastKnownDeviceState[key] = false
    end
  end
end

local function reconcileAllRules(reason)
  for _, rule in ipairs(deviceRules) do
    reconcileRule(rule, reason)
  end
end

-- Reconcile only rules whose attached/absent state changed while asleep: launch
-- the app when its device appeared, quit it when its device disappeared.
local function reconcileChangedDevices(previousState, currentState, reason)
  for _, rule in ipairs(deviceRules) do
    local key = deviceKeyForRule(rule)

    if not previousState or previousState[key] ~= currentState[key] then
      -- The device attach/detach state changed across sleep; treat it as an
      -- explicit signal and clear any self-quit suppression.
      resetQuitTracking(rule)
      if currentState[key] then
        launchAppIfNeeded(rule, reason)
      else
        quitAppIfRunning(rule, reason)
      end
    end
  end
end

lastKnownDeviceState = connectedDeviceState()

runtime.usbWatcher = hs.usb.watcher.new(function(data)
  if data.eventType == "added" then
    handleDeviceEvent(data, "usb-added")
  elseif data.eventType == "removed" then
    handleDeviceEvent(data, "usb-removed")
  end
end)

runtime.usbWatcher:start()

reconcileAllRules("startup")

runtime.caffeinateWatcher = hs.caffeinate.watcher.new(function(eventType)
  if eventType == hs.caffeinate.watcher.systemWillSleep then
    lastKnownDeviceState = connectedDeviceState()
    wakeReconcilePending = true
  elseif eventType == hs.caffeinate.watcher.systemDidWake then
    wakeReconcilePending = true

    doAfter(WAKE_RECONCILE_DELAY_SECONDS, function()
      local currentDeviceState = connectedDeviceState()

      if deviceStatesMatch(lastKnownDeviceState, currentDeviceState) then
        log.i("Skipping wake reconcile; USB state unchanged")
        wakeReconcilePending = false
        return
      end

      reconcileChangedDevices(
        lastKnownDeviceState,
        currentDeviceState,
        "system-wake USB state changed"
      )
      lastKnownDeviceState = currentDeviceState
      wakeReconcilePending = false
    end)
  end
end)

runtime.caffeinateWatcher:start()

-- Correctness backstop for transitions the watchers cannot observe (e.g. a
-- device removed while Hammerspoon was not running). Skip while a wake
-- reconcile is pending so we don't fight USB re-enumeration right after wake
-- and cause a quit/relaunch flicker.
runtime.heartbeatTimer = hs.timer.doEvery(HEARTBEAT_INTERVAL_SECONDS, function()
  if wakeReconcilePending then
    return
  end

  reconcileAllRules("heartbeat")
end)

-- Auto-reload when the config changes so a long-running Hammerspoon never keeps
-- executing stale logic. ~/.hammerspoon is a real directory whose init.lua is a
-- symlink into the nix store; a rebuild recreates that symlink, which FSEvents
-- reports as a change under hs.configdir.
runtime.configWatcher = hs.pathwatcher.new(hs.configdir, function(changedPaths)
  for _, file in ipairs(changedPaths) do
    if file:sub(-4) == ".lua" then
      log.i("Config changed; reloading")
      hs.reload()
      return
    end
  end
end)

runtime.configWatcher:start()

log.i("USB app watcher started")
