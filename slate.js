/*jslint
  white: true,
  nomen: true
*/
/*globals slate, _, S */

// Slate configuration:
// https://github.com/jigish/slate/wiki/JavaScript-Configs

function merge(obj, toMerge) {
    "use strict";
    var copy, attr, newAttr;
    if (null === obj || "object" !== typeof obj) {
        return obj;
    }
    copy = obj.constructor();
    for (attr in obj) {
        if (obj.hasOwnProperty(attr)) {
            copy[attr] = obj[attr];
        }
    }
    for (newAttr in toMerge) {
        if (toMerge.hasOwnProperty(newAttr)) {
            copy[newAttr] = toMerge[newAttr];
        }
    }
    return copy;
}


slate.config('defaultToCurrentScreen', true);
slate.config('checkDefaultsOnLoad', true);

var hostname = slate.shell('/bin/hostname', true).trim(),
    // default resolution - suitable for MacBook Air 13" and MacBook Pro 15"
    macResolution = '1440x900',
    macBookAir11Resolution = '1366x768',
    viewSonicResolution = '1920x1080',
    dellResolution = '1920x1200',
    oneScreenLayout,
    oneExternalScreenLayout,
    oneSmallScreenLayout,
    fullScreen = {
        'operations': [
            S.op("move", {
                'x': 'screenOriginX',
                'y': 'screenOriginY',
                'width': 'screenSizeX',
                'height': 'screenSizeY'
            })
        ]
    };

/*
 This layout makes sense because I have Emacs and iTerm2 on Spaces 2
 and 3. OmniFocus and Evernote are available on every Space.
*/
var defaultLayout = {
    'Emacs': fullScreen,
    'iTerm': fullScreen,
    'OmniFocus': fullScreen,
    'Evernote': fullScreen,
    'Calendar': fullScreen
};


// FIXME: why doesn't this hostname check work?
if (hostname === "kernel") {
    // home MacBook Air
    oneScreenLayout = S.layout('oneScreen', merge(defaultLayout, {
        'Evernote': fullScreen,
        'Mail': {
            'operations': [
                S.op("move", {
                    'x': '(screenSizeX - 1150) / 2',
                    'y': 'screenOriginY + (screenSizeY - 740)/2',
                    'width': '1150',
                    'height': '740'
                })
            ]
        }
    }));
}
else if (hostname.indexOf('GDS') !== -1) {
    oneScreenLayout = S.layout('oneScreen', defaultLayout);
    oneSmallScreenLayout = S.layout('oneSmallScreen', merge(defaultLayout, {
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
    }));
    oneExternalScreenLayout = S.layout('externalViewSonicScreen', merge(defaultLayout, {
        'Google Chrome': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX',
                    'y': 'screenOriginY',
                    'width': '1344',
                    'height': 'screenSizeY'
                })
            ]
        },
        'Safari': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX',
                    'y': 'screenOriginY',
                    'width': '1344',
                    'height': 'screenSizeY'
                })
            ]
        },
        'OmniFocus': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX',
                    'y': 'screenOriginY',
                    'width': '1344',
                    'height': 'screenSizeY'
                })
            ]
        },
        'Mailplane 3': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX',
                    'y': 'screenOriginY',
                    'width': '1344',
                    'height': 'screenSizeY'
                })
            ]
        },
        'Flint': {
            'operations': [
                S.op('move', {
                    'x': 'screenOriginX + 1344',
                    'y': 'screenOriginY',
                    'width': '576',
                    'height': 'screenSizeY'
                })
            ]
        }
    }));
    S.def([viewSonicResolution], "externalViewSonicScreen");
}

S.def([macResolution], "oneScreen");
S.def([macBookAir11Resolution], "oneSmallScreen");
slate.bind('h:ctrl;alt;cmd', slate.operation('layout', {'name': oneScreenLayout}));
slate.bind('r:ctrl;alt;cmd', slate.operation('relaunch'));

slate.default([macResolution], oneScreenLayout);
slate.default([macBookAir11Resolution], oneSmallScreenLayout);
slate.default([viewSonicResolution], oneExternalScreenLayout);
slate.default([dellResolution], oneExternalScreenLayout);
