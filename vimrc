set nocompatible

syntax on

set rtp+=bundle/Vundle.vim
call vundle#begin()
Plugin 'gmarik/Vundle.vim'

Plugin 'altercation/vim-colors-solarized'
Plugin 'fatih/vim-go'
Plugin 'tpope/vim-fugitive'

call vundle#end()
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
