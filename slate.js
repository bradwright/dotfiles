// Slate configuration:
// https://github.com/jigish/slate/wiki/JavaScript-Configs

/*jslint
  nomen: true
*/
/*globals slate, _, S */

slate.config('defaultToCurrentScreen', true);
slate.config('checkDefaultsOnLoad', true);

var hostname = slate.shell('/bin/hostname', true).trim(),
    // default resolution - suitable for MacBook Air 13" and MacBook Pro 15"
    macResolution = '1440x900';

// FIXME: why doesn't this hostname check work?
if (hostname === "kernel") {
    // home MacBook Air
    var oneScreenLayout = S.layout('oneScreen', {
        // show Emacs in the centre, 100 columns wide in current font
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

slate.bind('h:ctrl;alt;cmd', slate.operation('layout', {'name': oneScreenLayout}));
slate.bind('r:ctrl;alt;cmd', slate.operation('relaunch'));

slate.default([macResolution], oneScreenLayout);
