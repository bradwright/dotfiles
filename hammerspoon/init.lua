-- -*- mode: lua -*-

-- Launch and close apps automatically as matching USB devices appear
-- and disappear. This is useful when a USB hub is powered on after login or
-- disconnected later.

local log = hs.logger.new("usb-launch", "info")

local APP_LAUNCH_COOLDOWN_SECONDS = 5

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
    postLaunchKeyStroke = {
      delaySeconds = 3,
      mods = {"ctrl", "alt", "cmd"},
      key = "m",
    },
  },
}

local lastLaunchAt = {}

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

  if rule.postLaunchKeyStroke then
    local k = rule.postLaunchKeyStroke
    hs.timer.doAfter(k.delaySeconds, function()
      log.i(string.format("Sending post-launch keystroke for %s", appName))
      hs.eventtap.keyStroke(k.mods, k.key)
    end)
  end
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

local function anyConnectedDeviceMatchesRule(rule)
  for _, device in ipairs(hs.usb.attachedDevices() or {}) do
    if deviceMatchesRule(device, rule) then
      return true
    end
  end

  return false
end

local function handleDeviceEvent(device, eventName)
  local productName = device.productName or ""
  local vendorName = device.vendorName or ""

  for _, rule in ipairs(deviceRules) do
    if deviceMatchesRule(device, rule) then
      local reason = string.format("%s: %s / %s", eventName, vendorName, productName)

      if eventName == "initial-scan" or eventName == "usb-added" then
        launchAppIfNeeded(rule, reason)
      elseif eventName == "usb-removed" then
        hs.timer.doAfter(1, function()
          if not anyConnectedDeviceMatchesRule(rule) then
            quitAppIfRunning(rule, reason)
          end
        end)
      end
    end
  end
end

local function scanConnectedDevices()
  for _, device in ipairs(hs.usb.attachedDevices() or {}) do
    handleDeviceEvent(device, "initial-scan")
  end
end

local usbWatcher = hs.usb.watcher.new(function(data)
  if data.eventType == "added" then
    handleDeviceEvent(data, "usb-added")
  elseif data.eventType == "removed" then
    handleDeviceEvent(data, "usb-removed")
  end
end)

usbWatcher:start()
scanConnectedDevices()

log.i("USB app watcher started")
