document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('startup-modal');
  const overlay = document.getElementById('modal-overlay');
  const okBtn = document.getElementById('modal-ok');

  if (modal && overlay && okBtn) {
    // Initially the modal is in the HTML without 'hidden', or with 'hidden'
    // Ensure it shows up if it was hidden
    setTimeout(() => {
      modal.classList.remove('hidden');
      overlay.classList.remove('hidden');
    }, 100);

    // Hide modal on click of OK
    okBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
      overlay.classList.add('hidden');
    });
  }
});
