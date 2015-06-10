set nocompatible

syntax on

" Pathogen for packages
execute pathogen#infect()
filetype plugin indent on

" Unicode
set encoding=utf-8
set fileencoding=utf-8

" use 4 spaces for tabs
set expandtab tabstop=4 softtabstop=4 shiftwidth=4
set smarttab

" make backspace work in insert mode
set backspace=indent,eol,start

if !has("gui_running")
  set term=xterm-256color
endif

" solarized
" this applies when iTerm is using a Solarized profile, or
" it's a 16 color terminal
if (match(system("echo $ITERM_PROFILE"), "Solarized") != -1) || (match(system("echo $TERM"), "16-color") != -1)
  syntax enable
  set background=dark
  colorscheme solarized
endif

set ruler
set showcmd

let mapleader = ","
let maplocalleader = ","
