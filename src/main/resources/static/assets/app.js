// 되돌릴 수 없는 동작은 한 번 더 물음
document.addEventListener('submit', (event) => {
  const message = event.target.dataset.confirm;
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});

// 전원 배정을 고르면 담당자 선택을 잠금
document.addEventListener('change', (event) => {
  if (event.target.matches('[data-toggle-target]')) {
    const target = document.querySelector(event.target.dataset.toggleTarget);
    if (target) {
      target.disabled = event.target.checked;
    }
  }
});
