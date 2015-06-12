set nocompatible

filetype off

set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()
Plugin 'gmarik/Vundle.vim'

Plugin 'altercation/vim-colors-solarized'
Plugin 'fatih/vim-go'
Plugin 'tpope/vim-fugitive'
Plugin 'thoughtbot/pick.vim'

call vundle#end()


filetype plugin indent on
syntax on

" Always show statusline
set laststatus=2

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

set noswapfile

let mapleader = ","
let maplocalleader = ","

" Fugitive
nmap <leader>gs :Gstatus<cr>
nmap <leader>gc :Gcommit<cr>
nmap <leader>ga :Gwrite<cr>
nmap <leader>gl :Glog<cr>
nmap <leader>gd :Gdiff<cr>

" Pick
nnoremap <Leader>t :call PickFile()<CR>
nnoremap <Leader>pf :call PickFile()<CR>
nnoremap <Leader>ps :call PickFileSplit()<CR>
nnoremap <Leader>pv :call PickFileVerticalSplit()<CR>
nnoremap <Leader>b :call PickBuffer()<CR>
