const BASE_URL = window.location.origin.includes('codepen') 
  ? 'https://ejemplo-simulado-api.com' 
  : window.location.origin;            

// Ubicación fija para Open-Meteo (código postal 28521, Rivas-Vaciamadrid).
// Se llama DIRECTAMENTE desde el navegador (sin pasar por la Raspberry),
// igual que hace el Dashboard principal (ESTADO_MAESTRO seccion 2.1).
const METEO_LAT = 40.3417;
const METEO_LON = -3.5034;
const METEO_TZ = 'Europe/Madrid';
const METEO_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${METEO_LAT}&longitude=${METEO_LON}` +
  `&current=temperature_2m,precipitation,wind_speed_10m&timezone=${encodeURIComponent(METEO_TZ)}`;
const METEO_INTERVALO_MS = 15 * 60 * 1000; // 15 minutos

let configuracionLocal = { objetivo_temp: 19.0, paneles_forzar_apagado: false };
let isMeasuring = false;

window.addEventListener('DOMContentLoaded', () => {
  establecerFechaActual();
  registrarServiceWorker();
  arrancarBucleMonitoreo();
  arrancarBucleMeteo();
  enlazarEventosInteractivos();
});

function establecerFechaActual() {
  const hoy = new Date();
  document.getElementById('pwa-date').innerText = hoy.toLocaleDateString('es-ES');
}

function registrarServiceWorker() {
  if ('serviceWorker' in navigator && !window.location.origin.includes('codepen')) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log("SW Error:", err));
  }
}

let bindeoIntervalo;
function arrancarBucleMonitoreo() {
  realizarLlamadaEndpoints();
  bindeoIntervalo = setInterval(realizarLlamadaEndpoints, 60000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(bindeoIntervalo);
    } else {
      realizarLlamadaEndpoints();
      bindeoIntervalo = setInterval(realizarLlamadaEndpoints, 60000);
    }
  });
}

let bindeoMeteo;
function arrancarBucleMeteo() {
  consultarMeteoExterior();
  bindeoMeteo = setInterval(consultarMeteoExterior, METEO_INTERVALO_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(bindeoMeteo);
    } else {
      consultarMeteoExterior();
      bindeoMeteo = setInterval(consultarMeteoExterior, METEO_INTERVALO_MS);
    }
  });
}

async function consultarMeteoExterior() {
  // Nota sobre el bug ya documentado en el Dashboard principal (ESTADO_MAESTRO
  // seccion 3.4 y tarea 5 de la seccion 5): comparar UTC contra horarios en
  // hora local de Madrid daba lugar a un indice UV atascado en "--". Aqui no
  // usamos indice UV, y pedimos directamente timezone=Europe/Madrid a
  // Open-Meteo para que el "current" que devuelve ya venga en hora local,
  // sin necesidad de convertir nada a mano.
  try {
    const respuesta = await fetch(METEO_URL);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    const datos = await respuesta.json();
    const actual = datos && datos.current;

    if (!actual) throw new Error('Respuesta sin bloque "current"');

    document.getElementById('val-ext-temp').innerText = formatearONulo(actual.temperature_2m, 1);
    document.getElementById('val-ext-lluvia').innerText =
      (typeof actual.precipitation === 'number') ? actual.precipitation.toFixed(1) : '--';
    document.getElementById('val-ext-viento').innerText = formatearONulo(actual.wind_speed_10m, 0);
  } catch (error) {
    console.error("Fallo consultando Open-Meteo:", error);
    // Fail-safe: nunca dejamos un dato inventado o desactualizado sin más.
    document.getElementById('val-ext-temp').innerText = '--.-';
    document.getElementById('val-ext-lluvia').innerText = '--';
    document.getElementById('val-ext-viento').innerText = '--';
  }
}

// Pequeña ayuda: convierte a texto con decimales SOLO si el valor es un
// número real. Si es null/undefined (p.ej. panel_temp mientras no haya
// sonda de paneles cableada, ver ESTADO_MAESTRO seccion 3.2), devuelve el
// marcador "sin dato" en vez de reventar. Nunca inventamos un valor.
function formatearONulo(valor, decimales, sufijo) {
  if (typeof valor !== 'number' || Number.isNaN(valor)) {
    return decimales > 0 ? '-'.repeat(1) + '-.' + '-'.repeat(decimales - 1) : '--';
  }
  return valor.toFixed(decimales) + (sufijo || '');
}

async function realizarLlamadaEndpoints() {
  if (isMeasuring) return;
  actualizarEstadoConexion("CONSULTANDO...");

  if (window.location.origin.includes('codepen')) {
    setTimeout(() => {
      const simuaAgua = { disponible: true, temperatura: 19.0, ph: 7.3, conductividad: 698, orp: 715, segundos_de_antiguedad: 12 };
      const simuSistema = { temperatura_cpu: 45.2, uptime_segundos: 72000, red: { porcentaje: 85, tipo: 'wifi' } };
      // Nota: dejamos panel_temp en null a propósito en el mock también,
      // para que el desarrollo en CodePen refleje el escenario real actual
      // (sin sonda de paneles cableada) y no oculte este caso.
      const simuDecision = { disponible: true, panel_temp: null, pool_temp: 19.0, valvula_estado: 'PISCINA', paneles_estado: 'EN PARADA', depuradora_on: true, motivo_valvula: 'Aporte solar insuficiente' };
      const simuControl = { objetivo_temp: configuracionLocal.objetivo_temp, paneles_forzar_apagado: configuracionLocal.paneles_forzar_apagado };
      
      procesarDatosUI(simuaAgua, simuSistema, simuDecision, simuControl);
      actualizarEstadoConexion("CONECTADO (MOCK)", true);
    }, 400);
    return;
  }

  try {
    const [resAgua, resSistema, resDecision, resControl] = await Promise.all([
      fetch(`${BASE_URL}/api/agua`).then(r => r.json()),
      fetch(`${BASE_URL}/api/sistema`).then(r => r.json()),
      fetch(`${BASE_URL}/api/decision`).then(r => r.json()),
      fetch(`${BASE_URL}/api/control`).then(r => r.json())
    ]);

    procesarDatosUI(resAgua, resSistema, resDecision, resControl);
    actualizarEstadoConexion("CONECTADO", true);
  } catch (error) {
    // Importante: esto solo debe dispararse ante un fallo de RED real
    // (fetch rechazado, Raspberry inalcanzable, etc.). procesarDatosUI ya
    // no debe lanzar excepciones por datos ausentes (ver formatearONulo),
    // así que si esto salta, es una desconexión real, no un dato null.
    console.error("Fallo de red en API:", error);
    actualizarEstadoConexion("SIN CONEXIÓN", false);
    marcarDatosComoNoDisponibles();
  }
}

function procesarDatosUI(agua, sistema, decision, control) {
  if (agua && agua.disponible !== false) {
    document.getElementById('val-temp-piscina').innerText = formatearONulo(agua.temperatura, 1);
    document.getElementById('val-ph').innerText = formatearONulo(agua.ph, 1);
    document.getElementById('val-cond').innerText = `${formatearONulo(agua.conductividad, 0)} µS`;
    document.getElementById('val-orp').innerText = `${formatearONulo(agua.orp, 0)} mV`;
    document.getElementById('val-antiguedad').innerText =
      (typeof agua.segundos_de_antiguedad === 'number') ? `${Math.round(agua.segundos_de_antiguedad)}s` : '--';
    document.getElementById('lbl-ph').innerText = "Óptimo";
    document.getElementById('lbl-cond').innerText = "Óptimo";
    document.getElementById('lbl-orp').innerText = "Óptimo";
  } else {
    marcarDatosAguaVacios();
  }

  if (sistema) {
    document.getElementById('val-cpu').innerText = `${formatearONulo(sistema.temperatura_cpu, 1)} °C`;
    document.getElementById('val-uptime').innerText =
      (typeof sistema.uptime_segundos === 'number') ? `Up: ${Math.round(sistema.uptime_segundos / 3600)}h` : 'Up: --';
  }

  // Estado del motor de decisión.
  // panel_temp es null mientras no exista sonda de paneles cableada
  // (ESTADO_MAESTRO seccion 1 y 3.2) - esto es el comportamiento
  // CORRECTO del sistema, no un fallo, y debe mostrarse como "--", no
  // como una desconexión.
  if (decision && decision.disponible !== false) {
    document.getElementById('val-temp-paneles').innerText = formatearONulo(decision.panel_temp, 1);

    const elPaneles = document.getElementById('val-paneles-estado');
    const panelesActivos = (decision.paneles_estado || '').toUpperCase() === 'ACTIVOS';
    if (panelesActivos) {
      elPaneles.innerText = "ACTIVOS";
      elPaneles.className = "";
    } else {
      elPaneles.innerText = "OFF";
      elPaneles.className = "status-text-off";
    }

    const elValvula = document.getElementById('val-valvula-estado');
    const valvulaEnPaneles = (decision.valvula_estado || '').toUpperCase() === 'PANELES';
    if (valvulaEnPaneles) {
      elValvula.innerText = "PANELES";
      elValvula.className = "";
    } else {
      elValvula.innerText = "PISCINA";
      elValvula.className = "status-text-off";
    }

    const elDepuradora = document.getElementById('val-depuradora-estado');
    if (decision.depuradora_on) {
      elDepuradora.innerHTML = "EN<br>MARCHA";
      elDepuradora.className = "";
    } else {
      elDepuradora.innerText = "OFF";
      elDepuradora.className = "status-text-off";
    }

    document.getElementById('val-motivo-valvula').innerText = decision.motivo_valvula || '--';

    const hayDiferencial = (typeof decision.panel_temp === 'number' && typeof decision.pool_temp === 'number');
    if (hayDiferencial) {
      const dif = decision.panel_temp - decision.pool_temp;
      document.getElementById('val-dif-piscina').innerText = (dif >= 0 ? '+' : '') + dif.toFixed(1);
    } else {
      document.getElementById('val-dif-piscina').innerText = '--.-';
    }
  } else {
    marcarDecisionesVacias();
  }


  if (control) {
    configuracionLocal.objetivo_temp = (typeof control.objetivo_temp === 'number') ? control.objetivo_temp : configuracionLocal.objetivo_temp;
    configuracionLocal.paneles_forzar_apagado = !!control.paneles_forzar_apagado;

    document.getElementById('val-temp-objetivo').innerText = formatearONulo(configuracionLocal.objetivo_temp, 1);

    const btnOff = document.getElementById('panelsOff');
    if (configuracionLocal.paneles_forzar_apagado) {
      btnOff.classList.add('active-forced-off');
      btnOff.innerHTML = "ENCENDER<br>PANELES";
    } else {
      btnOff.classList.remove('active-forced-off');
      btnOff.innerHTML = "APAGAR<br>PANELES";
    }
  }
}

function marcarDatosAguaVacios() {
  document.getElementById('val-temp-piscina').innerText = "--.-";
  document.getElementById('val-ph').innerText = "--";
  document.getElementById('val-cond').innerText = "-- µS";
  document.getElementById('val-orp').innerText = "-- mV";
  document.getElementById('val-antiguedad').innerText = "--";
  document.getElementById('lbl-ph').innerText = "Sin Datos";
  document.getElementById('lbl-cond').innerText = "Sin Datos";
  document.getElementById('lbl-orp').innerText = "Sin Datos";
}

function marcarDecisionesVacias() {
  document.getElementById('val-temp-paneles').innerText = "--.-";
  document.getElementById('val-valvula-estado').innerText = "ESPERANDO";
  document.getElementById('val-paneles-estado').innerText = "ESPERANDO";
  document.getElementById('val-depuradora-estado').innerText = "--";
  document.getElementById('val-motivo-valvula').innerText = "Motor de control inactivo";
  document.getElementById('val-dif-piscina').innerText = "--.-";
}

function marcarDatosComoNoDisponibles() {
  marcarDatosAguaVacios();
  marcarDecisionesVacias();
}

function actualizarEstadoConexion(texto, conExito = null) {
  const indicador = document.getElementById('pwa-status');
  const banner = document.getElementById('status-banner');
  const bannerTxt = document.getElementById('status-banner-text');
  const statusIcon = document.getElementById('status-icon');
  
  if (!indicador) return;
  
  if (conExito === null) {
    indicador.innerText = "CONECTANDO...";
    indicador.className = "connecting status-init";
    if (banner) banner.className = "correct loading-state";
    if (bannerTxt) bannerTxt.innerText = "CONSULTANDO API...";
    if (statusIcon) {
      statusIcon.innerText = "⋯";
      statusIcon.style.color = "#566475";
    }
  } else if (conExito === true) {
    indicador.innerText = window.location.origin.includes('codepen') ? "CONECTADO (MOCK)" : "CONECTADO";
    indicador.className = "connecting status-online";
    if (banner) banner.className = "correct";
    if (bannerTxt) bannerTxt.innerText = "TODO CORRECTO";
    if (statusIcon) {
      statusIcon.innerText = "✓";
      statusIcon.style.color = "#007c12";
    }
  } else if (conExito === false) {
    indicador.innerText = "SIN CONEXIÓN";
    indicador.className = "connecting status-offline";
    if (banner) banner.className = "correct error-state";
    if (bannerTxt) bannerTxt.innerText = "ERR. CONEXIÓN RBP";
    if (statusIcon) {
      statusIcon.innerText = "✕";
      statusIcon.style.color = "#7c0000";
    }
  }
}

function enlazarEventosInteractivos() {
  document.getElementById('minus').addEventListener('click', () => {
    configuracionLocal.objetivo_temp = Math.max(10, configuracionLocal.objetivo_temp - 0.5);
    document.getElementById('val-temp-objetivo').innerText = configuracionLocal.objetivo_temp.toFixed(1);
    enviarDatosControlAPI();
  });

  document.getElementById('plus').addEventListener('click', () => {
    configuracionLocal.objetivo_temp = Math.min(40, configuracionLocal.objetivo_temp + 0.5);
    document.getElementById('val-temp-objetivo').innerText = configuracionLocal.objetivo_temp.toFixed(1);
    enviarDatosControlAPI();
  });

  document.getElementById('panelsOff').addEventListener('click', () => {
    configuracionLocal.paneles_forzar_apagado = !configuracionLocal.paneles_forzar_apagado;
    enviarDatosControlAPI();
  });

  document.getElementById('btn-medir').addEventListener('click', async () => {
    if (isMeasuring) return;
    
    isMeasuring = true;
    const btn = document.getElementById('btn-medir');
    btn.innerText = "MIDIENDO (35s)...";
    btn.disabled = true;

    if (window.location.origin.includes('codepen')) {
      setTimeout(() => {
        isMeasuring = false;
        btn.innerText = "FORZAR MEDICIÓN";
        btn.disabled = false;
        alert("Simulación de medición en CodePen completada con éxito.");
        realizarLlamadaEndpoints();
      }, 3000); 
      return;
    }

    try {
      const respuesta = await fetch(`${BASE_URL}/api/medir`, { method: 'POST' });
      const resultado = await respuesta.json();
      alert(resultado.exito ? "Medición completada con éxito." : `Fallo: ${resultado.motivo}`);
    } catch (e) {
      alert("Error de red al solicitar medición.");
    } finally {
      isMeasuring = false;
      btn.innerText = "FORZAR MEDICIÓN";
      btn.disabled = false;
      realizarLlamadaEndpoints();
    }
  });
}

async function enviarDatosControlAPI() {
  if (window.location.origin.includes('codepen')) {
    realizarLlamadaEndpoints();
    return;
  }

  try {
    await fetch(`${BASE_URL}/api/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configuracionLocal)
    });
    realizarLlamadaEndpoints();
  } catch (e) {
    console.error("Error enviando directivas de control:", e);
  }
}
