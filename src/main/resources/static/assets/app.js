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

// 고른 파일의 이름을 버튼 옆에 보여 줌
document.addEventListener('change', (event) => {
  if (event.target.matches('.file-pick input[type="file"]')) {
    const name = event.target.closest('.file-pick').querySelector('.file-name');
    const file = event.target.files[0];
    name.textContent = file ? file.name : '고른 파일 없음';
  }
});
