/*jslint
  white: true,
  nomen: true
*/
/*globals slate, _, S */

// Slate configuration:
// https://github.com/jigish/slate/wiki/JavaScript-Configs

slate.config('defaultToCurrentScreen', true);
slate.config('checkDefaultsOnLoad', true);

var hostname = slate.shell('/bin/hostname', true).trim(),
    // default resolution - suitable for MacBook Air 13" and MacBook Pro 15"
    macResolution = '1440x900',
    macBookAir11Resolution = '1366x768',
    viewSonicResolution = '1920x1080',
    oneScreenLayout,
    oneExternalScreenLayout,
    oneSmallScreenLayout;


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
    var fullScreen = {
        'operations': [
            S.op("move", {
                'x': 'screenOriginX',
                'y': 'screenOriginY',
                'width': 'screenSizeX',
                'height': 'screenSizeY'
            })
        ]
    };
    oneScreenLayout = S.layout('oneScreen', {
        'iTerm': fullScreen,
        'Emacs': fullScreen
    });
    oneSmallScreenLayout = S.layout('oneSmallScreen', {
        'iTerm': fullScreen,
        'Mailplane 3': fullScreen,
        'Emacs': fullScreen,
        'OmniFocus': fullScreen,
        'Google Chrome': {
            'operations': [
                S.op('move', {
                    'x': '(screenSizeX - 1340) / 2',
                    'y': 'screenOriginY + (screenSizeY - 700) / 2',
                    'width': '1340',
                    'height': '700'
                })
            ]
        },
        'Tweetbot': {
        'Safari': {
            'operations': [
                S.op('move', {
                    'x': '(screenSizeX - 1340) / 2',
                    'y': 'screenOriginY + (screenSizeY - 700) / 2',
                    'width': '1340',
                    'height': '700'
                })
            ]
        },
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX + (screenSizeX - 500)',
                    'y': 'screenOriginY + 11',
                    'width': '480',
                    'height': '640'
                })
            ]
        },
        'Messages': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX + 20',
                    'y': 'screenOriginY + 11',
                    'width': '730',
                    'height': '542'
                })
            ]
        }
    });
    oneExternalScreenLayout = S.layout('externalViewSonicScreen', {
        'Tweetbot': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX + (screenSizeX - 500)',
                    'y': 'screenOriginY + 11',
                    'width': '480',
                    'height': '640'
                })
            ]
        },
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
        'Safari': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX',
                    'y': 'screenOriginY',
                    'width': '1344',
                    'height': '1054'
                })
            ]
        },
        'OmniFocus': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX',
                    'y': 'screenOriginY',
                    'width': '1344',
                    'height': '1054'
                })
            ]
        },
        'Mailplane 3': {
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
        },
        'iTerm': fullScreen,
        'Emacs': fullScreen
    });
    S.def([viewSonicResolution], "externalViewSonicScreen");
}

S.def([macResolution], "oneScreen");
S.def([macBookAir11Resolution], "oneSmallScreen");
slate.bind('h:ctrl;alt;cmd', slate.operation('layout', {'name': oneScreenLayout}));
slate.bind('r:ctrl;alt;cmd', slate.operation('relaunch'));

slate.default([macResolution], oneScreenLayout);
