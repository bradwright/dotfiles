SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)

# Shell dotfiles symlinked as ~/.<name>
FILES		:= aliases local_gitconfig gitignore zshrc zshenv

# Personal executables symlinked into ~/bin
BIN_FILES	:= et

# Keys in the global pi settings that are managed dynamically by pi
# itself and should not be overwritten by the versioned config.
PI_LOCAL_KEYS := packages lastChangelogVersion defaultProvider defaultModel
PI_GLOBAL   := $(HOME)/.pi/agent/settings.json
PI_LOCAL    := $(SOURCE)/pi/settings.json

# Claude Code settings — merge versioned keys into the live config,
# preserving any keys Claude Code manages dynamically.
CLAUDE_GLOBAL := $(HOME)/.claude/settings.json
CLAUDE_LOCAL  := $(SOURCE)/claude/settings.json

.PHONY: install clean all \
	install_shell clean_shell \
	install_bin clean_bin \
	install_ghostty install_ghostty_terminfo clean_ghostty \
	install_starship clean_starship \
	install_fish clean_fish \
	install_nvim clean_nvim \
	install_hammerspoon clean_hammerspoon \
	install_atuin clean_atuin \
	install_pi \
	install_claude

.PHONY: $(addprefix install_bin_,$(BIN_FILES)) $(addprefix clean_bin_,$(BIN_FILES))

BIN_TARGETS := $(addprefix install_bin_,$(BIN_FILES))
BIN_CLEAN_TARGETS := $(addprefix clean_bin_,$(BIN_FILES))

$(BIN_TARGETS): install_bin_%:
	@mkdir -p $(TARGET)/bin
	@ln -sf $(SOURCE)/bin/$* $(TARGET)/bin/$*

$(BIN_CLEAN_TARGETS): clean_bin_%:
	@-unlink $(TARGET)/bin/$*

install_bin: $(BIN_TARGETS)

clean_bin: $(BIN_CLEAN_TARGETS)

all: clean install

# --- Aggregate targets ---

install: install_shell install_bin install_ghostty install_ghostty_terminfo install_starship install_fish install_nvim install_hammerspoon install_atuin install_pi install_claude

clean: clean_shell clean_bin clean_ghostty clean_starship clean_fish clean_nvim clean_hammerspoon clean_atuin

# --- Pi settings ---
# Merge versioned settings into the global pi config, preserving
# dynamic keys that pi manages itself.

install_pi:
	@mkdir -p $(dir $(PI_GLOBAL))
	@if [ -f $(PI_GLOBAL) ]; then \
		jq -s '(.[0] | {$(shell printf '"%s":.%s,' $(foreach k,$(PI_LOCAL_KEYS),$k $k) | sed 's/,$$//')}) as $$keep \
		  | .[0] * .[1] * ($$keep | with_entries(select(.value != null)))' \
		  $(PI_GLOBAL) $(PI_LOCAL) \
		  > $(PI_GLOBAL).tmp \
		&& mv $(PI_GLOBAL).tmp $(PI_GLOBAL); \
	else \
		cp $(PI_LOCAL) $(PI_GLOBAL); \
	fi

# --- Claude Code ---
# Merge versioned settings on top of the live config so that keys
# added dynamically by Claude Code are preserved.

install_claude:
	@mkdir -p $(dir $(CLAUDE_GLOBAL))
	@if [ -f $(CLAUDE_GLOBAL) ]; then \
		jq -s '.[0] * .[1]' $(CLAUDE_GLOBAL) $(CLAUDE_LOCAL) \
		  > $(CLAUDE_GLOBAL).tmp \
		&& mv $(CLAUDE_GLOBAL).tmp $(CLAUDE_GLOBAL); \
	else \
		cp $(CLAUDE_LOCAL) $(CLAUDE_GLOBAL); \
	fi

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

GHOSTTY_APP	:= /Applications/Ghostty.app

install_ghostty_terminfo:
	@if [ -d $(GHOSTTY_APP) ]; then \
		infocmp -x xterm-ghostty | tic -x -o $(HOME)/.terminfo -; \
	fi

clean_ghostty:
	@-unlink $(HOME)/.config/ghostty
	@-rm -f $(HOME)/.terminfo/78/xterm-ghostty

# --- Starship ---

install_starship:
	@mkdir -p $(TARGET)/.config/
	@ln -sf $(SOURCE)/starship.toml $(TARGET)/.config/starship.toml

clean_starship:
	@-unlink $(TARGET)/.config/starship.toml

# --- Fish ---

install_fish:
	@mkdir -p $(TARGET)/.config/fish/conf.d/
	@ln -sf $(SOURCE)/fish/config.fish $(TARGET)/.config/fish/config.fish
	@ln -sf $(SOURCE)/fish/fish_plugins $(TARGET)/.config/fish/fish_plugins
	@ln -sf $(SOURCE)/fish/conf.d/colors.fish $(TARGET)/.config/fish/conf.d/colors.fish
	@# Generate fish-specific starship config — identical to the main one
	@# except the prompt character is blue instead of purple.
	@sed 's/\[❯\](purple)/[❯](blue)/' $(SOURCE)/starship.toml > $(TARGET)/.config/fish/starship.toml

clean_fish:
	@-unlink $(TARGET)/.config/fish/config.fish
	@-unlink $(TARGET)/.config/fish/fish_plugins
	@-unlink $(TARGET)/.config/fish/conf.d/colors.fish
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

# --- Hammerspoon ---

install_hammerspoon:
	@mkdir -p $(TARGET)/.hammerspoon/
	@ln -sf $(SOURCE)/hammerspoon/init.lua $(TARGET)/.hammerspoon/init.lua

clean_hammerspoon:
	@-unlink $(TARGET)/.hammerspoon/init.lua

# --- Atuin ---

install_atuin:
	@mkdir -p $(TARGET)/.config/atuin/
	@ln -sf $(SOURCE)/atuin/config.toml $(TARGET)/.config/atuin/config.toml

clean_atuin:
	@-unlink $(TARGET)/.config/atuin/config.toml

