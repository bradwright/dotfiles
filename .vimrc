" cribbed from http://items.sjbach.com/319/configuring-vim-right
set hidden
nnoremap ' `
nnoremap ` '
let mapleader = ","
set history=1000
runtime macros/matchit.vim
set wildmode=list:longest

" make search case-sensitive only when a capital letter is involved
set ignorecase 
set smartcase

" show Vim title in the Terminal
set title

" show more stuff around the cursor
set scrolloff=3

" syntax highlighting
if has('syntax')
    syntax on
    filetype on
    filetype plugin on
    filetype indent on
    set background=dark
    colorscheme desert
endif

" don't annoy me
set visualbell

if has('gui_running')
    set encoding=utf-8
    set lines=50
    set columns=85
    set go-=T
    colorscheme ir_black
    set guioptions-=T
    set guioptions-=m
    set guifont=Inconsolata:h14
    set guitablabel=%t
else
    set background=dark
    colorscheme desert
end

" forget about Vi
set nocompatible

" Language-specific indenting

set ls=2
set showmode
set tabstop=4
set shiftwidth=4
set expandtab
set softtabstop=4

autocmd Filetype c,cpp,h,python,html,css,js,xml set tabstop=4 softtabstop=4 shiftwidth=4 expandtab

if has('mouse')
    set mouse=a
endif
set nomodeline
set showmatch

set fileencoding=utf-8


if has('cmdline_info')
    set ruler
    set rulerformat=%30(%=\:b%n%y%m%r%w\ %l,%c%V\ %P%)
    set showcmd
endif

" wrap around when crossing left and right edge of editors
" < and > are left and right in normal mode
" [ and ] are left and right when in inser mode
set whichwrap=<,>,h,l,~,[,]
set backspace=eol,start,indent
