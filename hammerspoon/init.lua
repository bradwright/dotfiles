-- -*- mode: lua -*-

-- Launch and close apps automatically as matching USB devices appear
-- and disappear. This is useful when a USB hub is powered on after login or
-- disconnected later.

local log = hs.logger.new("usb-launch", "info")

local APP_LAUNCH_COOLDOWN_SECONDS = 5

-- Delay after wake before reconciling app state, giving USB devices time to
-- re-enumerate so we don't falsely quit an app whose device is still attaching.
local WAKE_RECONCILE_DELAY_SECONDS = 3
local USB_REMOVAL_RECHECK_DELAY_SECONDS = 1

-- Backstop heartbeat: periodically enforce the invariant that each managed app
-- runs if and only if its USB device is attached. Covers state changes the
-- event watchers cannot see, e.g. a device removed while Hammerspoon was not
-- running (after a reload or relaunch), so no usb-removed event was delivered.
local HEARTBEAT_INTERVAL_SECONDS = 15

local deviceRules = {
  {
    vendorID = 4057,
    productID = 154,
    launchName = "Elgato Stream Deck",
    runningName = "Stream Deck",
  },
  {
    vendorID = 4057,
    productID = 154,
    launchName = "Elgato Control Center",
    runningName = "Elgato Control Center",
  },
  {
    vendorID = 11802,
    productID = 19457,
    launchName = "Insta360 Link Controller",
    runningName = "Insta360 Link Controller",
  },
}

local lastLaunchAt = {}

-- Last stable attached/absent state for the USB devices we manage. Wake can
-- trigger USB re-enumeration events, so use this to avoid re-launching apps
-- unless the effective USB state changed while the machine was asleep.
local lastKnownDeviceState = nil
local wakeReconcilePending = false

local function launchAppIfNeeded(rule, reason)
  local appName = rule.launchName
  local now = hs.timer.secondsSinceEpoch()
  local lastLaunch = lastLaunchAt[appName] or 0

  if now - lastLaunch < APP_LAUNCH_COOLDOWN_SECONDS then
    log.i(string.format("Skipping %s launch; cooldown active (%s)", appName, reason))
    return
  end

  lastLaunchAt[appName] = now
  log.i(string.format("Launching %s (%s)", appName, reason))
  hs.application.launchOrFocus(appName)
end

local function quitAppIfRunning(rule, reason)
  local appName = rule.runningName or rule.launchName
  local app = hs.application.get(appName)
  if not app then
    return
  end

  log.i(string.format("Closing %s (%s)", appName, reason))
  app:kill()
end

local function deviceMatchesRule(device, rule)
  return device.vendorID == rule.vendorID and device.productID == rule.productID
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

local function anyConnectedDeviceMatchesRule(rule)
  for _, device in ipairs(hs.usb.attachedDevices() or {}) do
    if deviceMatchesRule(device, rule) then
      return true
    end
  end

  return false
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

    hs.timer.doAfter(recheckDelay, function()
      if anyConnectedDeviceMatchesRule(matchingRules[1]) then
        if lastKnownDeviceState then
          lastKnownDeviceState[key] = true
        end
        return
      end

      for _, rule in ipairs(matchingRules) do
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
    -- Only launch when the app is absent. launchOrFocus() would activate (and
    -- steal focus to) an already-running app, which the heartbeat would
    -- otherwise do on every tick.
    if not hs.application.get(rule.runningName or rule.launchName) then
      launchAppIfNeeded(rule, reason)
    end
    if lastKnownDeviceState then
      lastKnownDeviceState[key] = true
    end
  else
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
      if currentState[key] then
        launchAppIfNeeded(rule, reason)
      else
        quitAppIfRunning(rule, reason)
      end
    end
  end
end

lastKnownDeviceState = connectedDeviceState()

local usbWatcher = hs.usb.watcher.new(function(data)
  if data.eventType == "added" then
    handleDeviceEvent(data, "usb-added")
  elseif data.eventType == "removed" then
    handleDeviceEvent(data, "usb-removed")
  end
end)

usbWatcher:start()
reconcileAllRules("startup")

local caffeinateWatcher = hs.caffeinate.watcher.new(function(eventType)
  if eventType == hs.caffeinate.watcher.systemWillSleep then
    lastKnownDeviceState = connectedDeviceState()
    wakeReconcilePending = true
  elseif eventType == hs.caffeinate.watcher.systemDidWake then
    wakeReconcilePending = true

    hs.timer.doAfter(WAKE_RECONCILE_DELAY_SECONDS, function()
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

caffeinateWatcher:start()

-- Correctness backstop for transitions the watchers cannot observe (e.g. a
-- device removed while Hammerspoon was not running). Skip while a wake
-- reconcile is pending so we don't fight USB re-enumeration right after wake
-- and cause a quit/relaunch flicker.
local heartbeatTimer = hs.timer.doEvery(HEARTBEAT_INTERVAL_SECONDS, function()
  if wakeReconcilePending then
    return
  end

  reconcileAllRules("heartbeat")
end)

-- Auto-reload when the config changes so a long-running Hammerspoon never keeps
-- executing stale logic. ~/.hammerspoon is a real directory whose init.lua is a
-- symlink into the nix store; a rebuild recreates that symlink, which FSEvents
-- reports as a change under hs.configdir.
local configWatcher = hs.pathwatcher.new(hs.configdir, function(changedPaths)
  for _, file in ipairs(changedPaths) do
    if file:sub(-4) == ".lua" then
      log.i("Config changed; reloading")
      hs.reload()
      return
    end
  end
end)

configWatcher:start()

log.i("USB app watcher started")
