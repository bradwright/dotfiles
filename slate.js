// Slate configuration:
// https://github.com/jigish/slate/wiki/JavaScript-Configs

/*jslint
  nomen: true,
  white: true
*/
/*globals slate, _, S */

slate.config('defaultToCurrentScreen', true);
slate.config('checkDefaultsOnLoad', true);

var hostname = slate.shell('/bin/hostname', true).trim(),
    // default resolution - suitable for MacBook Air 13" and MacBook Pro 15"
    macResolution = '1440x900',
    viewSonicResolution = '1920x1080',
    oneScreenLayout,
    oneExternalScreenLayout;


// FIXME: why doesn't this hostname check work?
if (hostname === "kernel") {
    // home MacBook Air
    oneScreenLayout = S.layout('oneScreen', {
        'Emacs': {
            'operations': [
                S.op("move", {
                    'x': '(screenSizeX - 821) / 2',
                    'y': '0',
                    'width': '821',
                    'height': '871'
                })
            ]
        },
        // show Mail right in the centre
        'Mail': {
            'operations': [
                S.op("move", {
                    'x': '(screenSizeX - 1150) / 2',
                    'y': 'screenOriginY + (screenSizeY - 740)/2',
                    'width': '1150',
                    'height': '740'
                })
            ]
        },
        // show iTerm in 140 columns wide, 30 deep
        'iTerm': {
            'operations': [
                S.op('move', {
                    'x': '(screenSizeX - 1130) / 2',
                    'y': 'screenOriginY + (screenSizeY - 556) / 2',
                    'width': '1130',
                    'height': '556'
                })
            ]
        }
    });
}
else if (hostname.indexOf('GDS') !== -1) {
    // GDS
    oneScreenLayout = S.layout('oneScreen', {
        'iTerm': {
            'operations': [
                S.op("move", {
                    'x': 'screenOriginX',
                    'y': 'screenOriginY',
                    'width': 'screenSizeX',
                    'height': 'screenSizeY'
                })
            ]
        }
    });
    oneExternalScreenLayout = S.layout('externalViewSonicScreen', {
        'Google Chrome': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX',
                    'y': 'screenOriginY',
                    'width': '1344',
                    'height': '1054'
                })
            ]
        },
        'Flint': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX + 1344',
                    'y': 'screenOriginY',
                    'width': '576',
                    'height': '1054'
                })
            ]
        }
    });
    S.def([viewSonicResolution], "externalViewSonicScreen");
}

S.def([macResolution], "oneScreen");
slate.bind('h:ctrl;alt;cmd', slate.operation('layout', {'name': oneScreenLayout}));
slate.bind('r:ctrl;alt;cmd', slate.operation('relaunch'));

slate.default([macResolution], oneScreenLayout);
