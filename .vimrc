set nocompatible
set ls=2
set showmode
set tabstop=4
set shiftwidth=4
set expandtab
set softtabstop=4
if has('mouse')
    set mouse=a
endif
set nomodeline
set showmatch
set title
set noautoindent
set nosmartindent

" i18n friendly
set fileencoding=utf-8

if has('syntax')
    syntax on
    colorscheme desert
endif

if has('cmdline_info')
    set ruler
    set rulerformat=%30(%=\:b%n%y%m%r%w\ %l,%c%V\ %P%)
    set showcmd
endif

filetype on

set whichwrap=h,l,~,[,]
set backspace=eol,start,indent
