# Elgato desk setup

These notes rebuild the desk lighting and webcam setup on a new Mac. Each
light preset on the Stream Deck sets the Key Lights and the webcam white
balance together, so the picture does not look blue or yellow.

## Hardware

- Elgato Stream Deck Neo (8 keys)
- Two Elgato Key Light MK.2, named `Accent - right` and `Fill - left`
- Insta360 Link webcam (the first model)

## Apps and plugins

```sh
brew install --cask elgato-stream-deck elgato-control-center hammerspoon
```

- Run `make install` to install the Hammerspoon config. Hammerspoon opens
  Stream Deck and Control Center when the Stream Deck is plugged in.
- In the Stream Deck app, install two plugins from the Elgato Marketplace:
  - **Control Center** (Elgato), for the Key Light actions
  - **Insta360 Webcam** (Insta360), for the webcam actions
- In Control Center, add both lights and give them the names above.

The Insta360 Webcam plugin controls the webcam over USB. It does not need
Insta360 Link Controller. Install Link Controller only to update the webcam
firmware, and open it by hand:

```sh
brew install --cask insta360-link-controller
```

## Main page

| Row    | Key 1       | Key 2        | Key 3     | Key 4           |
| ------ | ----------- | ------------ | --------- | --------------- |
| Top    | Apps folder | Links folder | Low light | Lights on / off |
| Bottom | Sunny       | Cloudy       | Dark      | Night           |

## Light presets

Each preset is a Multi Action with these steps, in this order:

1. Control Center **On / Off**, set to the On state.
2. **Set Brightness** and **Set Temperature** for `Accent - right`.
3. **Set Brightness** and **Set Temperature** for `Fill - left`.
4. Three Insta360 Webcam **Webcam Configuration** steps, each with camera
   `Insta360 Link`: Temperature, Saturation and Brightness, with the values
   below.

| Preset    | Accent - right | Fill - left  | Webcam temperature | Saturation | Brightness |
| --------- | -------------- | ------------ | ------------------ | ---------- | ---------- |
| Sunny     | 5 %, 5587 K    | 50 %, 5587 K | 5550 K             | 50         | 51         |
| Cloudy    | 10 %, 5587 K   | 20 %, 5618 K | 5600 K             | 50         | 51         |
| Dark      | 10 %, 4525 K   | 20 %, 4525 K | 4500 K             | 50         | 51         |
| Night     | 20 %, 3401 K   | 10 %, 3413 K | 4700 K             | 38         | 46         |
| Low light | no step        | 3 %, 3215 K  | no step            | no step    | no step    |

The Low light preset has steps for `Fill - left` only, with Accessory Link on.

The webcam keeps saturation and brightness until a step changes them. Each
preset with webcam steps sets all three values, so it does not keep the
values of the preset before it.

## Webcam values

- Start with the webcam temperature at the light temperature. A higher
  value makes the picture warmer.
- Under the Key Lights, the webcam needs a higher value than the lights. At
  Night, a webcam value of 3400 K made skin look pink: blue was higher than
  green.
- A warmer webcam value removes the pink, but it also makes skin more
  saturated and red. Lower the saturation to balance it. Values between pink
  and orange look red.
- At Night, 4900 K with saturation 35 and brightness 40 looked like an amber
  photo filter. 4700 K with saturation 38 and brightness 46 looked natural.
- Brighter Key Lights made skin pinker. Warmer Key Lights made skin much more
  orange. Change the webcam values, not the lights.
- The Dark preset has not been checked after dark. It may need the same
  change as Night.
- In the day, light from the window changes the result. With each preset on
  at 13:20 on 25 November 2026, the webcam auto white balance chose
  4900–5500 K.
- If the picture looks yellow, lower the webcam value. If it looks blue,
  raise it.
- The Webcam Configuration step turns off auto white balance before it sets
  the value.
- Do not add the plugin's Auto White Balance option to a preset. It toggles,
  so every second press turns auto white balance off again.

## Copy the profile

If the same Stream Deck, lights and webcam move to the new Mac, copy the
profile instead of building it again. In the Stream Deck app, open
Preferences, then Profiles, and export the profile. Import the file on the new
Mac.

The export contains the serial numbers of the lights and the webcam. Do not
commit it to this public repo.

## Check from a shell

The Key Lights have an HTTP API on port 9123:

```sh
dns-sd -B _elg._tcp local.                         # list the lights
dns-sd -L "Elgato Key Light MK 2 0F20" _elg._tcp local.  # host name
dns-sd -G v4 elgato-key-light-mk-2-0f20.local      # IP address
curl http://<ip>:9123/elgato/lights
```

The API gives `temperature` in mireds, from 143 to 344. Kelvin is
1,000,000 divided by the value, so 294 is 3401 K.

The Insta360 Webcam plugin includes the Insta360 control library. This script
prints the webcam white balance. The library path can change when the plugin
updates.

```sh
node -e '
const lib = require(process.env.HOME + "/Library/Application Support/com.elgato.StreamDeck/Plugins/com.insta360.webcam.sdPlugin/bin/sdk/macos/UVCCameraNode.node");
const camera = new lib.CameraController(lib.getCameraInfoList()[0]);
console.log({ auto: camera.autoWhiteBalance, kelvin: camera.whiteBalanceValue });
process.exit(0);'
```
