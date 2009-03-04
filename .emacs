;; When not using X, don't show the menu
(if (not window-system)
    (menu-bar-mode 0))

;; ============================
;; Setup syntax, background, and foreground coloring
;; ============================

;; Turn on syntax highlighting
(global-font-lock-mode t)

;; This font is OS X specific and will almost definitely hurt me one day
(set-default-font "Panic Sans")

;; Make sure that no tab characters are used:

(setq tab-width 4)
(setq-default indent-tabs-mode nil)

;; color themes
(require 'color-theme)
(color-theme-initialize)
(load-file "~/.emacs.d/themes/color-theme-blackboard.el")
(color-theme-blackboard)