(function () {
  const autenticado = localStorage.getItem('ta_auth') || localStorage.getItem('ta_token');
  if (!autenticado) window.location.replace('login.html');
})();
