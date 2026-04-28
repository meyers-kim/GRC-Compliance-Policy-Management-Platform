document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    const message = form.getAttribute('data-confirm') || 'Are you sure?';
    const confirmed = window.confirm(message);
    if (!confirmed) event.preventDefault();
  });
});

const flash = document.querySelector('.flash');
if (flash) {
  window.setTimeout(() => {
    flash.style.opacity = '0';
    flash.style.transition = 'opacity 0.2s ease';
    window.setTimeout(() => flash.remove(), 220);
  }, 2200);
}
