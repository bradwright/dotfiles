SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)

# Shell dotfiles symlinked as ~/.<name>
FILES		:= aliases local_gitconfig gitignore zshrc zshenv

.PHONY: install clean all \
	install_shell clean_shell \
	install_ghostty clean_ghostty \
	install_starship clean_starship \
	install_fish clean_fish \
	install_nvim clean_nvim

all: clean install

# --- Aggregate targets ---

install: install_shell install_ghostty install_starship install_fish install_nvim

clean: clean_shell clean_ghostty clean_starship clean_fish clean_nvim

# --- Shell ---

install_shell:
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/.$$f; \
	done
	@touch $(TARGET)/.hushlogin

clean_shell:
	@-for f in $(FILES); do \
		unlink $(TARGET)/.$$f; \
	done
	@-rm -f $(TARGET)/.hushlogin

# --- Ghostty ---

install_ghostty:
	@mkdir -p $(HOME)/.config/
	@ln -sf $(SOURCE)/ghostty $(HOME)/.config/ghostty

clean_ghostty:
	@-unlink $(HOME)/.config/ghostty

# --- Starship ---

install_starship:
	@mkdir -p $(TARGET)/.config/
	@ln -sf $(SOURCE)/starship.toml $(TARGET)/.config/starship.toml

clean_starship:
	@-unlink $(TARGET)/.config/starship.toml

# --- Fish ---

install_fish:
	@mkdir -p $(TARGET)/.config/fish/
	@ln -sf $(SOURCE)/fish/config.fish $(TARGET)/.config/fish/config.fish
	@ln -sf $(SOURCE)/fish/fish_plugins $(TARGET)/.config/fish/fish_plugins
	@# Generate fish-specific starship config — identical to the main one
	@# except the prompt character is blue instead of purple.
	@sed 's/\[❯\](purple)/[❯](blue)/' $(SOURCE)/starship.toml > $(TARGET)/.config/fish/starship.toml

clean_fish:
	@-unlink $(TARGET)/.config/fish/config.fish
	@-unlink $(TARGET)/.config/fish/fish_plugins
	@-rm -f $(TARGET)/.config/fish/starship.toml

# --- Neovim ---

install_nvim:
	@mkdir -p $(TARGET)/.config/nvim/ftplugin/
	@ln -sf $(SOURCE)/nvim/init.lua $(TARGET)/.config/nvim/init.lua
	@ln -sf $(SOURCE)/nvim/ftplugin/gitcommit.lua $(TARGET)/.config/nvim/ftplugin/gitcommit.lua
	@ln -sf $(SOURCE)/nvim/colors $(TARGET)/.config/nvim/colors

clean_nvim:
	@-unlink $(TARGET)/.config/nvim/init.lua
	@-unlink $(TARGET)/.config/nvim/ftplugin/gitcommit.lua
	@-unlink $(TARGET)/.config/nvim/colors

