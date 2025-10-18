import fetchWithRetry from './utils/fetchWithRetry.js';
import { normalizeApiResponse } from './utils/apiResponse.js';
// Bundled auth and navigation helpers

// ==== auth.js content ====
let currentUser = null;

async function fetchCurrentUser() {
    try {
        const r = await fetchWithRetry('backend/api/user.php');
        if (!r.ok) return null;
        const payload = await r.json().catch(() => null);
        const { data } = normalizeApiResponse(payload);
        return data || null;
    } catch (e) {
        return null;
    }
}

async function initAuth() {
    currentUser = await fetchCurrentUser();
    updateAuthUI();
    return currentUser;
}

function updateAuthUI() {
    document.dispatchEvent(new CustomEvent('auth-updated', { detail: currentUser }));
}

function loginWithGoogle() {
    window.location.href = 'backend/auth.php?provider=google';
}


function logout() {
    currentUser = null;
    updateAuthUI();
    navigator.serviceWorker?.controller?.postMessage({ type: 'invalidateAll' });
    window.location.href = 'backend/logout.php';
}

function requireAuth() {
    if (!currentUser) {
        window.location.href = '/login';
        return false;
    }
    return true;
}

function loginWithDiscord() {
    window.location.href = 'backend/auth.php?provider=discord';
}

window.Auth = {
    get currentUser() { return currentUser; },
    initAuth,
    loginWithGoogle,
    loginWithDiscord,
    logout,
    requireAuth
};

// ==== navigation.js partial content ====
// Theme manager and navigation creation
const ThemeManager = {
    init() {
        this.theme = localStorage.getItem('theme') || 'dark';
        this.applyTheme();
    },

    toggleTheme() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', this.theme);
        this.applyTheme();
    },

    applyTheme() {
        document.body.classList.toggle('light-theme', this.theme === 'light');
        document.body.classList.toggle('dark-theme', this.theme === 'dark');

        const bg = document.getElementById('bg-video');
        const overlay = document.getElementById('bg-overlay');
        if (bg) {
            bg.classList.toggle('dark', this.theme === 'dark');
        }
        if (overlay) {
            overlay.style.background = this.theme === 'dark'
                ? 'rgba(0,0,0,0.1)'
                : 'rgba(255,255,255,0.6)';
        }

        const themeButtons = document.querySelectorAll('.theme-toggle');
        themeButtons.forEach(btn => {
            btn.textContent = this.theme === 'dark' ? '🌙' : '☀️';
        });
    }
};

/**
 * navigationData.menuItems[].submenu admite distintos nodos para describir un submenú.
 *
 * Formatos soportados:
 *  - Enlaces simples: { text, href, icon?, target?, class?, requiresLogin? }
 *    `text` define la etiqueta visible, `href` el destino y `icon` (opcional) añade
 *    un icono decorativo antes del texto.
 *  - Agrupaciones: { type: 'group', title?, icon?, class?, items: LinkNode[] }
 *    `title` se muestra como encabezado del grupo y `items` contiene los enlaces
 *    que pertenecen a la agrupación.
 *
 * Cualquier nodo puede incluir las propiedades comunes de los elementos del menú
 * principal (como `onClick`, `style`, etc.), y la propiedad `submenu` es opcional
 * en todos los elementos.
 */
const navigationData = {
    menuItems: [
        { placement: 'center', text: 'Inicio', href: '/', target: 'tab-detalles', class: '', submenu: null },
        { placement: 'center', text: 'Dones', href: '/dones', target: 'tab-crafteo', class: '', submenu: null },
        { placement: 'center', text: 'Comparativa', href: '/compare-craft', target: 'tab-comparativa', class: '', requiresLogin: true, submenu: null },
        { placement: 'center', text: 'Legendarias', href: '/leg-craft', target: 'tab-leg-craft', class: '', submenu: null },
        { placement: 'center', text: 'Bolsas', href: '/bag-craft', target: 'tab-bag-craft', class: '', submenu: null },
        {
            placement: 'center',
            text: 'Datos',
            href: '#datos',
            target: 'tab-datos',
            class: '',
            submenu: [
                { text: 'Fractales', href: '/fractales-gold', target: 'tab-fractales', requiresLogin: true },
                { text: 'Forja Mística', href: '/forja-mistica', target: 'tab-forja-mistica' }
            ]
        },
        {
            placement: 'right',
            text: '🌙',
            href: '#',
            target: '',
            class: 'right-btn theme-toggle',
            id: 'theme-toggle',
            closeOnNavigate: true,
            onClick: (e) => {
                e.preventDefault();
                ThemeManager.toggleTheme();
            }
        },
        {
            placement: 'right',
            text: 'Iniciar sesión',
            href: '#',
            target: '',
            class: 'right-btn',
            id: 'loginBtn',
            onClick: (e) => {
                e.preventDefault();
                window.location.href = '/login';
            }
        },
        {
            placement: 'right',
            text: '',
            href: '#',
            target: '',
            class: 'right-btn requires-login user-info-link',
            id: 'userInfo',
            closeOnNavigate: false,
            submenu: [
                {
                    text: 'Mi cuenta',
                    href: '/cuenta'
                },
                {
                    text: 'Cerrar sesión',
                    href: '#',
                    onClick: (e) => {
                        e.preventDefault();
                        if (window.Auth && typeof window.Auth.logout === 'function') {
                            window.Auth.logout();
                        }
                    }
                }
            ]
        }
    ]
};
function updateAuthMenu() {
    const loginBtn = document.getElementById('loginBtn');
    const userInfo = document.getElementById('userInfo');
    const user = currentUser;
    const isLoggedIn = !!user;
    document.body.classList.toggle('logged-in', isLoggedIn);
    if (loginBtn) loginBtn.classList.toggle('hidden', isLoggedIn);

    function toggleLoginElements() {
        document.querySelectorAll('[data-requires-login]').forEach(el => {
            el.classList.toggle('requires-login', !isLoggedIn);
        });
    }

    toggleLoginElements();

    if (userInfo) {
        let textSpan = userInfo.querySelector('.item-text');
        if (!textSpan) {
            textSpan = document.createElement('span');
            textSpan.className = 'item-text';
            userInfo.appendChild(textSpan);
        }

        let avatarImg = userInfo.querySelector('img.user-avatar');
        if (!avatarImg) {
            avatarImg = document.createElement('img');
            avatarImg.className = 'user-avatar';
            avatarImg.alt = 'avatar';
            avatarImg.style.width = '24px';
            avatarImg.style.height = '24px';
            avatarImg.style.borderRadius = '50%';
            avatarImg.style.verticalAlign = 'middle';
            avatarImg.style.marginRight = '5px';
            userInfo.insertBefore(avatarImg, textSpan);
        }

        if (isLoggedIn && user) {
            avatarImg.style.display = '';
            avatarImg.src = user.avatar || 'img/avatar-placeholder.svg';
            avatarImg.alt = user.name || 'avatar';
            textSpan.textContent = user.name || 'Usuario';
        } else {
            avatarImg.style.display = 'none';
            avatarImg.removeAttribute('src');
            textSpan.textContent = '';
        }
    }

    const activeBtn = document.querySelector('.tab-button.active');
    if (activeBtn) {
        const tabId = activeBtn.getAttribute('data-tab');
        if (tabId && typeof window.switchTab === 'function') {
            window.switchTab(tabId);
        }
    }
}

function showAuthOptions() {
    let modal = document.getElementById('auth-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'auth-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="auth-modal-content">
                <h3 style='margin-bottom:18px;color:#fff;'>Iniciar sesión</h3>
                <button id="google-login-btn" class="auth-btn google-btn">
                    <img src="img/google-icon.svg" alt="google" onerror="this.onerror=null;this.src='img/icon-auth-fallback.svg';"> Google
                </button>
                <button id="discord-login-btn" class="auth-btn discord-btn">
                    <img src="img/discord-icon.svg" alt="discord" onerror="this.onerror=null;this.src='img/icon-auth-fallback.svg';"> Discord
                </button>
                <a href="/login" class="auth-classic-link">¿Prefieres iniciar sesión clásico?</a>
                <button onclick="document.getElementById('auth-modal').remove()" class="auth-cancel-btn">Cancelar</button>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('google-login-btn').onclick = () => {
            if (window.Auth && window.Auth.loginWithGoogle) window.Auth.loginWithGoogle();
        };
        document.getElementById('discord-login-btn').onclick = () => {
            if (window.Auth && window.Auth.loginWithDiscord) window.Auth.loginWithDiscord();
        };
    }
}

const navigationMenuState = (() => {
    const controllers = new Set();
    let handlersBound = false;

    const closeAllMenus = (exceptController = null) => {
        controllers.forEach(controller => {
            if (controller !== exceptController) {
                controller.closeMenu();
            }
        });
    };

    const getOpenController = () => {
        for (const controller of controllers) {
            if (controller.isOpen()) {
                return controller;
            }
        }
        return null;
    };

    const ensureGlobalHandlers = () => {
        if (handlersBound) return;
        handlersBound = true;

        document.addEventListener('pointerdown', (event) => {
            if (!event.target.closest('.menu-item.has-submenu.is-open')) {
                closeAllMenus();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' || event.key === 'Esc') {
                const openController = getOpenController();
                if (openController) {
                    closeAllMenus();
                    openController.link.focus();
                    event.preventDefault();
                    event.stopPropagation();
                }
            }
        });
    };

    return {
        register(controller) {
            controllers.add(controller);
            ensureGlobalHandlers();
        },
        unregister(controller) {
            controllers.delete(controller);
        },
        closeAllMenus,
        handleNavigation() {
            closeAllMenus();
        }
    };
})();

function createNavigation() {
    const nav = document.createElement('nav');
    nav.className = 'topbar item-tabs-bar';

    const createLinkElement = (linkData, baseClass = 'item-tab', options = {}) => {
        const { closeOnNavigate: optionCloseOnNavigate } = options;
        const shouldCloseOnNavigate = linkData.closeOnNavigate ?? (optionCloseOnNavigate ?? true);
        const link = document.createElement('a');
        link.href = linkData.href || '#';
        link.className = `${baseClass} ${linkData.class || ''}`.trim();
        if (linkData.target) link.setAttribute('data-target', linkData.target);
        if (linkData.id) link.id = linkData.id;
        if (linkData.requiresLogin) link.classList.add('requires-login');
        if (linkData.style) link.setAttribute('style', linkData.style);
        if (linkData.onClick) link.addEventListener('click', linkData.onClick);

        if (linkData.icon) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'item-icon';
            iconSpan.textContent = linkData.icon;
            link.appendChild(iconSpan);

            const textSpan = document.createElement('span');
            textSpan.className = 'item-text';
            textSpan.textContent = linkData.text || '';
            link.appendChild(textSpan);
        } else {
            link.textContent = linkData.text || '';
        }

        if (shouldCloseOnNavigate) {
            link.addEventListener('click', () => {
                navigationMenuState.handleNavigation();
            });
        }

        return link;
    };

    const createSubMenuElement = (submenuData) => {
        if (!submenuData) return null;

        const nodes = Array.isArray(submenuData) ? submenuData : [submenuData];
        if (!nodes.length) return null;

        const subMenu = document.createElement('div');
        subMenu.className = 'sub-menu';

        const appendNode = (node, parent, { defaultLinkClass } = {}) => {
            if (!node) return false;

            if (node.type === 'group') {
                const groupWrapper = document.createElement('div');
                groupWrapper.className = `submenu-group ${node.class || ''}`.trim();

                if (node.title) {
                    const titleEl = document.createElement('div');
                    titleEl.className = 'submenu-group-title';
                    titleEl.textContent = node.title;
                    groupWrapper.appendChild(titleEl);
                }

                const itemsContainer = document.createElement('div');
                itemsContainer.className = 'submenu-group-items';
                let hasItems = false;

                (node.items || []).forEach(groupItem => {
                    hasItems = appendNode(groupItem, itemsContainer, { defaultLinkClass: 'submenu-group-link' }) || hasItems;
                });

                if (hasItems || groupWrapper.children.length) {
                    groupWrapper.appendChild(itemsContainer);
                    parent.appendChild(groupWrapper);
                    return true;
                }

                return false;
            }

            if (node.type === 'grid' || node.layout === 'grid') {
                const gridWrapper = document.createElement('div');
                gridWrapper.className = `submenu-grid ${node.class || ''}`.trim();

                const columns = node.columns || node.items || [];
                let gridHasContent = false;

                const appendEntries = (entries, columnEl) => {
                    if (!entries) return false;
                    const list = Array.isArray(entries) ? entries : [entries];
                    let columnHasContent = false;
                    list.forEach(entry => {
                        columnHasContent = appendNode(entry, columnEl, { defaultLinkClass: 'submenu-grid-link' }) || columnHasContent;
                    });
                    return columnHasContent;
                };

                (Array.isArray(columns) ? columns : [columns]).forEach(column => {
                    if (!column) return;
                    const columnEl = document.createElement('div');
                    columnEl.className = `submenu-grid-column ${column.class || ''}`.trim();

                    if (column.title || column.icon) {
                        const titleEl = document.createElement('div');
                        titleEl.className = 'submenu-grid-title';

                        if (column.icon) {
                            const iconSpan = document.createElement('span');
                            iconSpan.className = 'submenu-grid-icon';
                            iconSpan.textContent = column.icon;
                            titleEl.appendChild(iconSpan);
                        }

                        if (column.title) {
                            const textSpan = document.createElement('span');
                            textSpan.className = 'submenu-grid-title-text';
                            textSpan.textContent = column.title;
                            titleEl.appendChild(textSpan);
                        }

                        columnEl.appendChild(titleEl);
                    }

                    if (column.description) {
                        const descriptionEl = document.createElement('div');
                        descriptionEl.className = 'submenu-grid-description';
                        descriptionEl.textContent = column.description;
                        columnEl.appendChild(descriptionEl);
                    }

                    let columnHasContent = false;
                    columnHasContent = appendEntries(column.items, columnEl) || columnHasContent;
                    columnHasContent = appendEntries(column.links, columnEl) || columnHasContent;

                    if (column.footer) {
                        columnHasContent = appendEntries(column.footer, columnEl) || columnHasContent;
                    }

                    if (columnHasContent || columnEl.children.length) {
                        gridWrapper.appendChild(columnEl);
                        gridHasContent = true;
                    }
                });

                if (gridHasContent) {
                    parent.appendChild(gridWrapper);
                    return true;
                }

                return false;
            }

            const baseClassValue = (node.baseClass || defaultLinkClass || 'sub-menu-link').trim();
            const baseClasses = baseClassValue ? baseClassValue.split(/\s+/) : [];
            if (!baseClasses.includes('item-tab')) {
                baseClasses.push('item-tab');
            }
            if (!baseClasses.includes('submenu-link')) {
                baseClasses.push('submenu-link');
            }
            const baseClassName = baseClasses.join(' ');
            const subLink = createLinkElement(node, baseClassName);
            parent.appendChild(subLink);
            return true;
        };

        let hasContent = false;
        nodes.forEach(node => {
            hasContent = appendNode(node, subMenu) || hasContent;
        });

        return hasContent ? subMenu : null;
    };

    const createMenuItem = (item) => {
        const menuItem = document.createElement('div');
        menuItem.className = 'menu-item';

        const link = createLinkElement(item, 'item-tab', {
            closeOnNavigate: item.submenu ? false : item.closeOnNavigate
        });
        menuItem.appendChild(link);

        const subMenu = createSubMenuElement(item.submenu);
        if (subMenu) {
            menuItem.classList.add('has-submenu');
            link.setAttribute('aria-haspopup', 'true');
            link.setAttribute('aria-expanded', 'false');
            menuItem.appendChild(subMenu);

            const controller = {
                link,
                menuItem,
                openMenu: () => {
                    navigationMenuState.closeAllMenus(controller);
                    menuItem.classList.add('is-open');
                    link.setAttribute('aria-expanded', 'true');
                },
                closeMenu: () => {
                    menuItem.classList.remove('is-open');
                    link.setAttribute('aria-expanded', 'false');
                },
                isOpen: () => menuItem.classList.contains('is-open')
            };
            navigationMenuState.register(controller);

            menuItem.addEventListener('pointerenter', controller.openMenu);
            menuItem.addEventListener('pointerleave', controller.closeMenu);
            menuItem.addEventListener('focusin', controller.openMenu);
            menuItem.addEventListener('focusout', (event) => {
                if (!menuItem.contains(event.relatedTarget)) {
                    controller.closeMenu();
                }
            });

            menuItem.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' || event.key === 'Esc') {
                    if (menuItem.classList.contains('is-open')) {
                        controller.closeMenu();
                        link.focus();
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }
            });

            link.addEventListener('click', (event) => {
                event.preventDefault();
                if (controller.isOpen()) {
                    controller.closeMenu();
                } else {
                    controller.openMenu();
                }
            });
        }

        return menuItem;
    };

    const menuCenter = document.createElement('div');
    menuCenter.className = 'menu-center';

    const menuRight = document.createElement('div');
    menuRight.className = 'menu-right';

    const placements = navigationData.menuItems.reduce((acc, item) => {
        const placement = item.placement === 'right' ? 'right' : 'center';
        acc[placement].push(item);
        return acc;
    }, { center: [], right: [] });

    placements.center.forEach(item => {
        menuCenter.appendChild(createMenuItem(item));
    });

    placements.right.forEach(item => {
        menuRight.appendChild(createMenuItem(item));
    });

    nav.appendChild(menuCenter);
    nav.appendChild(menuRight);

    return nav;
}

function initNavigation() {
    const header = document.querySelector('header');
    if (header) {
        const nav = createNavigation();
        header.insertBefore(nav, header.firstChild);
        ThemeManager.init();
        updateAuthMenu();
    }
}
document.addEventListener('auth-updated', updateAuthMenu);

function onReady() {
    initNavigation();
    initAuth();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
} else {
    onReady();
}

window.updateAuthMenu = updateAuthMenu;
window.showAuthOptions = showAuthOptions;
