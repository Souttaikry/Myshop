function renderProfitChart(labels, salesData) {
  const canvas = document.getElementById('profitChart');
  const emptyState = document.getElementById('analysisChartEmpty');

  if (!salesData || salesData.length === 0) {
    canvas.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }
  canvas.style.display = 'block';
  emptyState.style.display = 'none';

  if (profitChartInstance) {
    profitChartInstance.destroy();
  }

  profitChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels, // e.g. ['2012','2013','2014','2015','2016','2017']
      datasets: [{
        label: 'Sales (USD)',
        data: salesData, // e.g. [15000,18000,16000,19000,22000,24000]
        borderColor: '#ED7D31',
        backgroundColor: '#ED7D31',
        pointBackgroundColor: '#ED7D31',
        pointBorderColor: '#ED7D31',
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2,
        tension: 0.25,
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Annual Sales Trend',
          font: { size: 16, weight: 'bold' }
        },
        datalabels: {
          align: 'top',
          anchor: 'end',
          offset: 6,
          color: '#000',
          font: { weight: 'bold', size: 11 },
          formatter: (value) => value.toLocaleString()
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.formattedValue}`
          }
        }
      },
      scales: {
        y: {
          title: { display: true, text: 'Sales (USD)' },
          grid: { color: '#e5e5e5' }
        },
        x: {
          title: { display: true, text: 'Years' },
          grid: { display: false }
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}