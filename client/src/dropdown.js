// Custom dropdown on top of a native <select>. The select stays in the DOM,
// hidden, and remains the source of truth: code keeps reading and setting
// `.value`, filling options and toggling `.disabled`, and a pick fires the
// select's own `change` event.
function createDropdown(select) {
  const wrapper = document.createElement('div');
  wrapper.className = `dropdown ${select.className}`.trim();
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dropdown-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'dropdown-label';
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.classList.add('dropdown-chevron');
  chevron.innerHTML = '<path d="M7 10l5 5 5-5" />';
  trigger.append(label, chevron);

  // Lives in <body> so overflow and stacking of the parents cannot clip it.
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  document.body.append(menu);

  select.before(wrapper);
  wrapper.append(trigger, select);
  select.hidden = true;

  let active = -1;

  function render() {
    const option = select.selectedOptions[0];
    label.textContent = option ? option.text : '';
    trigger.disabled = select.disabled;
    trigger.title = select.title;
    trigger.setAttribute('aria-label', select.title);
    if (select.disabled) close();
  }

  function renderMenu() {
    menu.replaceChildren(
      ...[...select.options].map((option, index) => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.classList.toggle('active', index === active);
        item.textContent = option.text;
        item.addEventListener('mousemove', () => setActive(index));
        item.addEventListener('click', () => pick(index));
        return item;
      }),
    );
  }

  function setActive(index) {
    if (index === active) return;
    active = index;
    menu.querySelectorAll('.dropdown-item').forEach((item, i) => {
      item.classList.toggle('active', i === active);
      if (i === active) item.scrollIntoView({ block: 'nearest' });
    });
  }

  // Opens below the trigger, or above it when there is more room there.
  function place() {
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const openUp = menu.scrollHeight > below && above > below;
    menu.style.maxHeight = `${Math.max(80, openUp ? above : below)}px`;
    menu.style.minWidth = `${rect.width}px`;
    menu.style.top = openUp ? '' : `${rect.bottom + gap}px`;
    menu.style.bottom = openUp ? `${window.innerHeight - rect.top + gap}px` : '';
    const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - margin);
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.classList.toggle('up', openUp);
  }

  function open() {
    if (select.disabled || !menu.hidden) return;
    active = select.selectedIndex;
    renderMenu();
    menu.hidden = false;
    place();
    wrapper.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    menu.querySelector('.dropdown-item.active')?.scrollIntoView({ block: 'nearest' });
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
  }

  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    wrapper.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
  }

  function pick(index) {
    close();
    trigger.focus();
    if (index < 0 || index === select.selectedIndex) return;
    select.selectedIndex = index;
    render();
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function onOutside(event) {
    if (!wrapper.contains(event.target) && !menu.contains(event.target)) close();
  }

  trigger.addEventListener('click', () => (menu.hidden ? open() : close()));
  trigger.addEventListener('keydown', (event) => {
    const count = select.options.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (menu.hidden) {
          open();
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((active + step + count) % count);
        break;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (menu.hidden) open();
        else pick(active);
        break;
      case 'Escape':
      case 'Tab':
        close();
        break;
    }
  });

  // Programmatic `.value` changes fire no event, so watch the setter too.
  const { get, set } = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    'value',
  );
  Object.defineProperty(select, 'value', {
    get() {
      return get.call(this);
    },
    set(value) {
      set.call(this, value);
      render();
    },
  });
  new MutationObserver(render).observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled', 'title'],
  });
  // `.disabled` is reflected to the attribute, so the observer sees it.
  render();
}
