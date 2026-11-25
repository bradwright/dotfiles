-- -*- mode: lua -*-
-- Run from the repo root with: lua hammerspoon/test.lua
-- Uses a fake hs API; no apps are opened or closed by these tests.

local config = arg and arg[1] or "hammerspoon/init.lua"
local streamDeckID = "com.elgato.StreamDeck"
local controlCenterID = "com.corsair.ControlCenter"
local usbDevice = { vendorID = 4057, productID = 154 }

local function setup(attached, controlCenterRunning)
  local state = { now = 100, apps = {}, launches = {}, kills = {}, timers = {} }
  state.devices = attached and { usbDevice } or {}
  local hs = { processInfo = {}, configdir = "/fake" }
  local function watcher(callback)
    return { callback = callback, start = function() end }
  end
  function state.addApp(bundleID, name, pid)
    local app = {
      pid = function() return pid end,
      bundleID = function() return bundleID end,
      name = function() return name end,
      kill = function()
        state.kills[bundleID] = (state.kills[bundleID] or 0) + 1
        state.apps[bundleID] = nil
      end,
    }
    state.apps[bundleID] = app
    return app
  end
  if attached then
    state.addApp(streamDeckID, "Stream Deck", 10)
  end
  if controlCenterRunning then
    state.addApp(controlCenterID, "ControlCenter", 11)
  end
  hs.logger = { new = function() return { i = function() end, w = function() end } end }
  hs.timer = {
    secondsSinceEpoch = function() return state.now end,
    doAfter = function(_, callback)
      local timer = watcher(callback)
      table.insert(state.timers, timer)
      return timer
    end,
    doEvery = function(_, callback) return watcher(callback) end,
  }
  local function launch(bundleID)
    table.insert(state.launches, bundleID)
    local name = bundleID == streamDeckID and "Stream Deck" or "ControlCenter"
    local pid = bundleID == streamDeckID and 10 or 11
    local app = state.addApp(bundleID, name, pid)
    if state.runtime then
      state.runtime.appWatcher.callback(name, hs.application.watcher.launched, app)
    end
    return true
  end
  hs.application = {
    applicationsForBundleID = function(bundleID)
      return state.apps[bundleID] and { state.apps[bundleID] } or {}
    end,
    -- Retain the old name-based API so this test reproduces the original bug.
    get = function(name)
      for _, app in pairs(state.apps) do
        if app:name() == name then return app end
      end
    end,
    launchOrFocus = function(name)
      return launch(name == "Elgato Control Center" and controlCenterID or streamDeckID)
    end,
    launchOrFocusByBundleID = launch,
    watcher = { new = watcher, launched = 1, terminated = 2 },
  }
  hs.usb = {
    attachedDevices = function() return state.devices end,
    watcher = { new = watcher },
  }
  hs.caffeinate = { watcher = { new = watcher, systemWillSleep = 1, systemDidWake = 2 } }
  hs.pathwatcher = { new = function(_, callback) return watcher(callback) end }
  local env = setmetatable({ hs = hs }, { __index = _G })
  env._G = env
  assert(loadfile(config, "t", env))()
  state.runtime = env.usbAppAutomation
  function state.tick()
    state.now = state.now + 15
    state.runtime.heartbeatTimer.callback()
  end
  function state.flushTimers()
    local timers = state.timers
    state.timers = {}
    for _, timer in ipairs(timers) do timer.callback() end
  end
  function state.usbEvent(attachedNow)
    state.devices = attachedNow and { usbDevice } or {}
    state.runtime.usbWatcher.callback({
      vendorID = usbDevice.vendorID,
      productID = usbDevice.productID,
      eventType = attachedNow and "added" or "removed",
    })
  end
  function state.terminateControlCenter()
    state.apps[controlCenterID] = nil
    -- Hammerspoon's terminated callback has no name; only the PID is usable.
    state.runtime.appWatcher.callback(nil, hs.application.watcher.terminated, {
      pid = function() return 11 end,
    })
  end
  return state
end

local function test(name, fn)
  fn()
  print("PASS " .. name)
end

test("startup and heartbeat do not reopen a renamed running app", function()
  local state = setup(true, true)
  for _ = 1, 3 do state.tick() end
  assert(#state.launches == 0, "running ControlCenter was reopened")
end)

test("an absent app launches once by bundle ID", function()
  local state = setup(true, false)
  for _ = 1, 3 do state.tick() end
  assert(#state.launches == 1 and state.launches[1] == controlCenterID)
end)

test("USB attach does not focus apps that are already running", function()
  local state = setup(false, false)
  state.addApp(streamDeckID, "Stream Deck", 10)
  state.addApp(controlCenterID, "ControlCenter", 11)
  state.usbEvent(true)
  assert(#state.launches == 0)
end)

test("wake reconciliation does not focus apps that are already running", function()
  local state = setup(false, false)
  state.runtime.caffeinateWatcher.callback(1)
  state.devices = { usbDevice }
  state.addApp(streamDeckID, "Stream Deck", 10)
  state.addApp(controlCenterID, "ControlCenter", 11)
  state.runtime.caffeinateWatcher.callback(2)
  state.flushTimers()
  state.tick()
  assert(#state.launches == 0)
end)

test("a deliberate quit stays quit until the device is reattached", function()
  local state = setup(true, true)
  state.terminateControlCenter()
  state.tick()
  assert(#state.launches == 0, "intentional quit was undone")
  state.usbEvent(false)
  state.flushTimers()
  state.usbEvent(true)
  assert(state.apps[controlCenterID], "reattach did not clear quit suppression")
end)

test("apps launched after startup are tracked for intentional quits", function()
  local state = setup(false, false)
  state.usbEvent(true)
  state.terminateControlCenter()
  local launchCount = #state.launches
  state.tick()
  assert(#state.launches == launchCount, "newly launched app was not tracked")
end)

test("device removal closes only the managed bundle", function()
  local state = setup(true, true)
  state.addApp("com.apple.controlcenter", "ControlCenter", 12)
  state.usbEvent(false)
  state.flushTimers()
  assert(state.kills[controlCenterID] == 1)
  assert(state.apps["com.apple.controlcenter"], "Apple Control Center was closed")
end)

test("the Insta360 Link launches no app", function()
  local state = setup(false, false)
  local camera = { vendorID = 11802, productID = 19457 }
  state.devices = { camera }
  state.runtime.usbWatcher.callback({
    vendorID = camera.vendorID,
    productID = camera.productID,
    eventType = "added",
  })
  state.tick()
  assert(#state.launches == 0, "attaching the camera launched " .. tostring(state.launches[1]))
end)
