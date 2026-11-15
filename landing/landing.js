/* Landing pública — animaciones y curvas de nivel (TSK-OFF-021).
 * Archivo aparte (no en línea) porque la CSP de Caddy sólo permite scripts
 * propios (TSK-OFF-023). */
(() => {
  // ---------- Curvas de nivel generadas (relieve tipo carta topográfica) ----------
  function topo(el, seed) {
    const W = 1440, H = 900, NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    const rnd = (n) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); };
    const cerros = [
      { x: W * (0.72 + rnd(1) * 0.15), y: H * (0.25 + rnd(2) * 0.2), r: 520 },
      { x: W * (0.08 + rnd(3) * 0.15), y: H * (0.85 + rnd(4) * 0.1), r: 420 },
    ];
    cerros.forEach((c, ci) => {
      const anillos = 15;
      for (let k = 1; k <= anillos; k++) {
        const base = (c.r / anillos) * k;
        let d = "";
        const pasos = 90;
        for (let i = 0; i <= pasos; i++) {
          const t = (i / pasos) * Math.PI * 2;
          const ruido =
            Math.sin(t * 3 + rnd(ci + 5) * 6 + k * 0.18) * (base * 0.09) +
            Math.sin(t * 5 + rnd(ci + 9) * 6 - k * 0.11) * (base * 0.045) +
            Math.sin(t * 2 + k * 0.3) * (base * 0.06);
          const r = base + ruido;
          const x = c.x + Math.cos(t) * r * 1.25;
          const y = c.y + Math.sin(t) * r * 0.82;
          d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        }
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d + "Z");
        p.setAttribute("fill", "none");
        const maestra = k % 5 === 0;
        const claro = el.dataset.tono === "claro";
        p.setAttribute("stroke", claro
          ? (maestra ? "rgba(180,83,9,.22)" : "rgba(23,25,28,.07)")
          : (maestra ? "rgba(240,168,40,.30)" : "rgba(168,176,186,.13)"));
        p.setAttribute("stroke-width", maestra ? "1.4" : "1");
        svg.appendChild(p);
      }
    });
    el.appendChild(svg);
  }
  document.querySelectorAll("[data-topo]").forEach((el, i) => topo(el, i + 1));

  // ---------- Escena: captura sin señal → sincronización → panel ----------
  const escena = document.getElementById("escena");
  const registros = [...escena.querySelectorAll(".registro")];
  const $ = (id) => document.getElementById(id);
  const pendientes = $("pendientes"), aviso = $("aviso-red"), avion = $("avion"), control = $("control");
  const m = { insp: $("m-insp"), hall: $("m-hall"), pend: $("m-pend"), lat: $("m-lat") };
  const actualizado = $("actualizado"), ultimaBarra = $("barras").lastElementChild;
  const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let timers = [], pausado = false, visible = true;
  const en = (ms, fn) => timers.push(setTimeout(fn, ms));
  const limpiar = () => { timers.forEach(clearTimeout); timers = []; };

  function marcar(out, valor) {
    out.textContent = valor;
    out.classList.add("cambio");
    setTimeout(() => out.classList.remove("cambio"), 1400);
  }

  function estadoInicial() {
    escena.dataset.fase = "offline";
    registros.forEach((r) => { r.classList.remove("visible"); r.dataset.estado = "pendiente"; r.querySelector(".estado").textContent = "Pendiente"; });
    pendientes.textContent = "0";
    aviso.textContent = "Sin señal. Todo queda guardado aquí.";
    avion.style.visibility = "visible";
    m.insp.textContent = "12"; m.hall.textContent = "4"; m.pend.textContent = "0"; m.lat.textContent = "—";
    actualizado.textContent = "Esperando datos";
    ultimaBarra.style.setProperty("--h", "22%");
  }

  function estadoFinal() {
    escena.dataset.fase = "listo";
    registros.forEach((r) => { r.classList.add("visible"); r.dataset.estado = "sincronizado"; r.querySelector(".estado").textContent = "Sincronizado"; });
    pendientes.textContent = "0";
    aviso.textContent = "Señal recuperada. Todo sincronizado.";
    avion.style.visibility = "hidden";
    m.insp.textContent = "14"; m.hall.textContent = "5"; m.pend.textContent = "0"; m.lat.textContent = "38 s";
    actualizado.textContent = "Hace 38 s";
    ultimaBarra.style.setProperty("--h", "48%");
  }

  function ciclo() {
    limpiar();
    estadoInicial();
    // 1. Captura sin señal
    registros.forEach((r, i) => en(700 + i * 1100, () => {
      r.classList.add("visible");
      pendientes.textContent = String(i + 1);
    }));
    en(4300, () => { m.pend.textContent = "—"; });
    // 2. Vuelve la señal
    en(5000, () => {
      escena.dataset.fase = "sube";
      avion.style.visibility = "hidden";
      aviso.textContent = "Señal recuperada. Enviando…";
      actualizado.textContent = "Recibiendo lote";
      registros.forEach((r) => { r.dataset.estado = "sincronizando"; r.querySelector(".estado").textContent = "Enviando"; });
    });
    // 3. Llega al panel, uno a uno
    registros.forEach((r, i) => en(6300 + i * 650, () => {
      r.dataset.estado = "sincronizado";
      r.querySelector(".estado").textContent = "Sincronizado";
      pendientes.textContent = String(registros.length - i - 1);
      if (i === 0) marcar(m.insp, "13");
      if (i === 1) marcar(m.hall, "5");
      if (i === 2) { marcar(m.insp, "14"); ultimaBarra.style.setProperty("--h", "48%"); }
    }));
    en(8400, () => {
      escena.dataset.fase = "listo";
      aviso.textContent = "Señal recuperada. Todo sincronizado.";
      marcar(m.pend, "0");
      marcar(m.lat, "38 s");
      actualizado.textContent = "Hace 38 s";
    });
    // 4. Pausa y repite
    en(13500, () => { if (!pausado && visible) ciclo(); });
  }

  function arrancar() { if (!pausado && visible) ciclo(); }

  if (reducido) {
    estadoFinal();
    control.hidden = true;
  } else {
    control.addEventListener("click", () => {
      pausado = !pausado;
      control.setAttribute("aria-pressed", String(pausado));
      control.textContent = pausado ? "Reanudar" : "Pausar";
      if (pausado) { limpiar(); estadoFinal(); } else ciclo();
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => {
        const antes = visible;
        visible = e.isIntersecting;
        if (visible && !antes) arrancar();
        if (!visible) limpiar();
      }, { threshold: 0.25 }).observe(escena);
    }
    arrancar();
  }
})();
