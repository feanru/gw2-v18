self.onmessage = (e) => {
  const { history } = e.data || {};
  if (!Array.isArray(history) || history.length === 0) {
    self.postMessage({ empty: true });
    return;
  }
  const horas = history.map(d => d.date || '');
  const horaMin = horas[0] || '';
  const horaMax = horas[horas.length - 1] || '';
  const totalHoras = horas.length;
  const etiquetas = horas.map(h => {
    let dateObj;
    if (h.includes('T')) {
      dateObj = new Date(h);
    } else if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(h)) {
      dateObj = new Date(h.replace(' ', 'T'));
    }
    if (dateObj && !isNaN(dateObj)) {
      return `${dateObj.getHours().toString().padStart(2,'0')}:00`;
    }
    const match = h.match(/(\d{2}):(\d{2})/);
    return match ? `${match[1]}:00` : h;
  });
  const ventas = history.map(d => d.sell_sold || 0);
  const compras = history.map(d => d.buy_sold || 0);
  self.postMessage({ etiquetas, ventas, compras, horaMin, horaMax, totalHoras });
};
