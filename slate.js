// Slate configuration:
// https://github.com/jigish/slate/wiki/JavaScript-Configs

/*jslint
  nomen: true
*/
/*globals slate, _, S */

slate.config('defaultToCurrentScreen', true);
slate.config('checkDefaultsOnLoad', true);

var hostname = slate.shell('/bin/hostname', true),
    // default resolution - suitable for MacBook Air 13" and MacBook Pro 15"
    macResolution = '1440x900';

// FIXME: why doesn't this hostname check work?
if (hostname === "kernel" || true) {
    // home MacBook Air
    var oneScreenLayout = S.layout('oneScreen', {
        'Emacs': {
            'operations': [
                S.op("move", {
                    'x': '(screenSizeX-821)/2',
                    'y': '0',
                    'width': '821',
                    'height': '871'
                })
            ]
        },
        // TODO
        'Mail': {
            'operations': "move (screenSizeX-1150)/2;screenOriginY+(screenSizeY-740)/2 1150;740" + macResolution
        },
        // TODO
        'iTerm': {
            'operations': "move (screenSizeX-1130)/2;screenOriginY+(screenSizeY-556)/2 1130;556 " + macResolution
        }
    });
}

slate.bind('d:ctrl;alt;cmd', slate.operation('layout', {'name': oneScreenLayout}));

slate.default([macResolution], oneScreenLayout);
