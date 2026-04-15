(() => {
  function createDemoDrawController(config) {
    const state = config.state;
    const getParticipants = config.getParticipants;
    const getParticipantChances = config.getParticipantChances;
    const colorFor = config.colorFor;
    const initials = config.initials;
    const participantLocation = config.participantLocation;
    const escapeHtml = config.escapeHtml;
    const showToast = config.showToast;
    const targetToken = String(config.targetToken || '').trim().toLowerCase();
    let animationTimeout = null;

    function stop() {
      if (animationTimeout) {
        clearTimeout(animationTimeout);
        animationTimeout = null;
      }
    }

    function getTargetIndex(participants) {
      if (!targetToken) return -1;
      return participants.findIndex((participant) => {
        const haystack = [
          participant?.publicCode,
          participant?.displayName,
          participant?.name,
          participant?.searchIndex
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(targetToken);
      });
    }

    function buildBasePool(participants) {
      const pool = [];
      participants.forEach((participant, participantIndex) => {
        if (!participant) return;
        const chances = getParticipantChances(participant);
        for (let chanceNumber = 1; chanceNumber <= chances; chanceNumber += 1) {
          pool.push({
            participantIndex,
            chanceNumber,
            chanceLabel: `${participant.displayName || participant.name} · chance ${chanceNumber}`
          });
        }
      });
      return pool;
    }

    function buildControlledCycle() {
      const participants = getParticipants();
      const pool = buildBasePool(participants);
      state.basePool = pool;
      if (!pool.length) {
        state.cycle = [];
        state.cyclePosition = 0;
        state.spotlightPosition = -1;
        state.finalEntry = null;
        return;
      }

      const targetIndex = getTargetIndex(participants);
      const targetEntries = targetIndex >= 0
        ? pool.filter((entry) => entry.participantIndex === targetIndex)
        : [];

      if (!targetEntries.length) {
        state.cycle = [...pool];
        state.cyclePosition = 0;
        state.spotlightPosition = state.cycle.length - 1;
        state.finalEntry = state.cycle[state.spotlightPosition] || null;
        return;
      }

      const finalEntry = targetEntries[targetEntries.length - 1];
      const cycle = [];
      let finalEntryUsed = false;
      pool.forEach((entry) => {
        const isFinalEntry =
          !finalEntryUsed &&
          entry.participantIndex === finalEntry.participantIndex &&
          entry.chanceNumber === finalEntry.chanceNumber;
        if (isFinalEntry) {
          finalEntryUsed = true;
          return;
        }
        cycle.push(entry);
      });
      cycle.push(finalEntry);

      state.cycle = cycle;
      state.cyclePosition = 0;
      state.spotlightPosition = cycle.length - 1;
      state.finalEntry = finalEntry;
    }

    function getActiveParticipant() {
      const participants = getParticipants();
      if (state.activeParticipantIndex < 0 || !participants[state.activeParticipantIndex]) {
        return null;
      }
      return participants[state.activeParticipantIndex];
    }

    function updateControls() {
      const showcase = document.getElementById('drawShowcase');
      const startBtn = document.getElementById('drawStartBtn');
      const saveBtn = document.getElementById('saveDemoResultBtn');
      if (!showcase || !startBtn || !saveBtn) return;
      showcase.classList.toggle('paused', state.paused);
      startBtn.disabled = !getParticipants().length || state.hasStarted;
      startBtn.style.opacity = startBtn.disabled ? '0.5' : '1';
      saveBtn.disabled = !getActiveParticipant() || !state.paused || !state.hasStarted;
      saveBtn.style.opacity = saveBtn.disabled ? '0.5' : '1';
    }

    function syncParticipantTableFocus(activeIndex, isSpotlight) {
      const rows = document.querySelectorAll('.participant-main-row');
      if (!state.hasStarted) {
        rows.forEach((row) => {
          row.classList.remove('is-draw-active', 'is-draw-spotlight');
        });
        document.getElementById('drawShowcase')?.classList.remove('is-focus-locked');
        return;
      }

      rows.forEach((row) => {
        const rowIndex = Number(row.dataset.participantIndex);
        const isActive = rowIndex === activeIndex;
        row.classList.toggle('is-draw-active', isActive && !isSpotlight);
        row.classList.toggle('is-draw-spotlight', isActive && isSpotlight);
      });

      const activeRow = document.querySelector(`.participant-main-row[data-participant-index="${activeIndex}"]`);
      const scroller = document.getElementById('participantsTableScroller');
      if (!activeRow || !scroller) return;

      const rowTop = activeRow.offsetTop;
      const rowBottom = rowTop + activeRow.offsetHeight;
      const currentTop = scroller.scrollTop;
      const visibleTop = currentTop + 54;
      const visibleBottom = currentTop + scroller.clientHeight - 54;
      const shouldLockView = isSpotlight || !state.paused;

      if (shouldLockView || rowTop < visibleTop || rowBottom > visibleBottom) {
        const targetTop = Math.max(0, rowTop - (scroller.clientHeight * 0.45));
        scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
      }

      if (shouldLockView) {
        document.getElementById('drawShowcase')?.classList.add('is-focus-locked');
      }
    }

    function getNarrative(participant, isSpotlight, cycleProgress) {
      if (isSpotlight) {
        return 'La demostración terminó de recorrer todas las chances y se cerró sobre el participante objetivo configurado para la prueba.';
      }
      if (cycleProgress < 0.18) {
        return 'El sistema empezó a barrer la urna completa para que se vea, chance por chance, cómo se construye la selección.';
      }
      if (cycleProgress < 0.72) {
        return 'La animación sigue avanzando por cada chance activa para que el recorrido resulte claro, visual y fácil de auditar.';
      }
      return 'El cierre ya está cerca: ahora el recorrido entra en su tramo final y prepara la selección definitiva de la demo.';
    }

    function getDelay(participant, isSpotlight) {
      const total = Math.max(state.cycle.length, 1);
      const progress = state.cyclePosition / total;
      const chanceWeight = Math.min(getParticipantChances(participant), 15);
      if (isSpotlight) {
        return 2600;
      }
      if (progress < 0.12) {
        return 85 + (chanceWeight * 2);
      }
      if (progress < 0.78) {
        return 110 + (chanceWeight * 3);
      }
      return 170 + (chanceWeight * 4);
    }

    function renderEmpty() {
      stop();
      state.activeParticipantIndex = -1;
      state.activeEntryNumber = 0;
      state.activeEntryPosition = 0;
      state.activeSpotlight = false;
      state.hasStarted = false;
      state.paused = true;
      document.getElementById('drawShowcase')?.classList.remove('is-focus-locked');
      document.getElementById('drawFeaturedCard')?.classList.remove('spotlight');
      syncParticipantTableFocus(-1, false);
      document.getElementById('drawRoundCounter').textContent = '0';
      document.getElementById('drawFeaturedAvatar').textContent = '--';
      document.getElementById('drawFeaturedAvatar').style.background = 'rgba(255,255,255,0.06)';
      document.getElementById('drawFeaturedAvatar').style.color = 'var(--text)';
      document.getElementById('drawFeaturedName').textContent = 'La animación se activará sola';
      document.getElementById('drawFeaturedMeta').innerHTML = '<span class="draw-featured-pill">Sin datos todavia</span>';
      document.getElementById('drawFeaturedScore').textContent = '0';
      document.getElementById('drawPhaseLabel').textContent = 'Demo lista';
      document.getElementById('drawPhaseName').textContent = 'Esperando participantes para mostrar el recorrido';
      document.getElementById('drawPhaseHint').textContent = 'Cuando haya participantes visibles, la demostración podrá recorrer todas las chances antes de cerrar el resultado.';
      document.getElementById('drawIntelFill').style.width = '14%';
      const rail = document.getElementById('drawRail');
      if (rail) {
        rail.innerHTML = '<div class="draw-rail-empty">Todavia no hay participantes visibles para iniciar el recorrido animado.</div>';
      }
      updateControls();
    }

    function render(entry, isSpotlight) {
      const participants = getParticipants();
      if (!participants.length || !entry || typeof entry.participantIndex !== 'number') {
        renderEmpty();
        return;
      }

      const participant = participants[entry.participantIndex];
      if (!participant) {
        renderEmpty();
        return;
      }

      const cycleProgress = state.cycle.length
        ? (state.cyclePosition + 1) / state.cycle.length
        : 0;
      const activeColor = colorFor(entry.participantIndex);
      state.activeParticipantIndex = entry.participantIndex;
      state.activeEntryNumber = entry.chanceNumber;
      state.activeEntryPosition = state.cyclePosition + 1;
      state.activeSpotlight = Boolean(isSpotlight);
      syncParticipantTableFocus(entry.participantIndex, isSpotlight);
      document.getElementById('drawShowcase')?.classList.toggle('is-focus-locked', Boolean(isSpotlight));

      const featuredCard = document.getElementById('drawFeaturedCard');
      featuredCard?.classList.toggle('spotlight', Boolean(isSpotlight));
      document.getElementById('drawFeaturedAvatar').textContent = initials(participant.displayName || participant.name);
      document.getElementById('drawFeaturedAvatar').style.background = `${activeColor}22`;
      document.getElementById('drawFeaturedAvatar').style.color = activeColor;
      document.getElementById('drawFeaturedName').textContent = participant.displayName || participant.name;
      document.getElementById('drawFeaturedMeta').innerHTML = `
        <span class="draw-featured-pill">${escapeHtml(participant.province || 'Argentina')}</span>
        <span class="draw-featured-pill">${escapeHtml(participant.city || 'Sin ciudad')}</span>
        <span class="draw-featured-pill">Chance ${entry.chanceNumber} de ${getParticipantChances(participant)}</span>
        <span class="draw-featured-pill">${participant.publicCode ? escapeHtml(participant.publicCode) : 'Registro visible'}</span>
      `;
      document.getElementById('drawFeaturedScore').textContent = getParticipantChances(participant).toLocaleString('es-AR');
      document.getElementById('drawRoundCounter').textContent = String(state.round);
      document.getElementById('drawPhaseLabel').textContent = isSpotlight ? 'Resultado de la demo' : 'Recorrido en vivo';
      document.getElementById('drawPhaseName').textContent = isSpotlight
        ? `${participant.displayName || participant.name} quedó seleccionado en la demostración`
        : `Recorriendo ${state.activeEntryPosition.toLocaleString('es-AR')} de ${state.cycle.length.toLocaleString('es-AR')} chances`;
      document.getElementById('drawPhaseHint').textContent = getNarrative(participant, isSpotlight, cycleProgress);
      document.getElementById('drawIntelFill').style.width = `${Math.max(14, Math.min(100, cycleProgress * 100))}%`;

      const visibleCards = [];
      const rail = document.getElementById('drawRail');
      const cardCount = Math.min(Math.max(state.cycle.length, 1), 5);
      for (let offset = 0; offset < cardCount; offset += 1) {
        const cyclePosition = Math.min(state.cyclePosition + offset, state.cycle.length - 1);
        const cycleEntry = state.cycle[cyclePosition];
        const item = participants[cycleEntry?.participantIndex];
        if (!cycleEntry || !item) continue;
        visibleCards.push(`
          <div class="draw-rail-card${offset === 0 ? ' active' : ''}${cyclePosition === state.spotlightPosition ? ' spotlight' : ''}">
            <span class="draw-rail-name">${escapeHtml(item.displayName || item.name)}</span>
            <div class="draw-rail-meta">
              <span>${escapeHtml(participantLocation(item))}</span>
              <span>Chance ${cycleEntry.chanceNumber}</span>
            </div>
          </div>
        `);
      }
      if (rail) {
        rail.innerHTML = visibleCards.join('');
      }
    }

    function pause() {
      state.paused = true;
      stop();
      updateControls();
      document.getElementById('drawPhaseLabel').textContent = 'Prueba finalizada';
      document.getElementById('drawPhaseName').textContent = 'La demo completó el recorrido y fijó el participante seleccionado';
      document.getElementById('drawPhaseHint').textContent = 'Ahora puedes registrar este resultado visual. Esta demostración sirve para explicar el mecanismo y no define un ganador oficial.';
    }

    function prepareRound() {
      buildControlledCycle();
      state.round += 1;
    }

    function tick() {
      const participants = getParticipants();
      if (!participants.length) {
        renderEmpty();
        return;
      }
      if (state.paused) {
        updateControls();
        return;
      }
      if (!state.cycle.length || state.cyclePosition >= state.cycle.length) {
        prepareRound();
      }
      if (!state.cycle.length) {
        renderEmpty();
        return;
      }

      const cyclePosition = state.cyclePosition;
      const entry = state.cycle[cyclePosition];
      const participant = participants[entry?.participantIndex];
      if (!entry || !participant) {
        state.cyclePosition += 1;
        tick();
        return;
      }

      const isSpotlight = cyclePosition === state.spotlightPosition;
      render(entry, isSpotlight);
      state.cyclePosition += 1;
      const delay = getDelay(participant, isSpotlight);

      if (isSpotlight) {
        animationTimeout = setTimeout(() => {
          pause();
          if (targetToken) {
            showToast(`Demostración completada sobre el participante objetivo: ${participant.displayName || participant.name}.`);
          }
        }, delay);
        return;
      }

      animationTimeout = setTimeout(() => {
        tick();
      }, delay);
    }

    function startTrial() {
      if (!getParticipants().length) {
        renderEmpty();
        return;
      }
      state.hasStarted = true;
      state.paused = false;
      prepareRound();
      updateControls();
      document.getElementById('participantsTableScroller')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('drawPhaseLabel').textContent = 'Prueba en curso';
      document.getElementById('drawPhaseName').textContent = 'El sistema está recorriendo todas las chances visibles';
      document.getElementById('drawPhaseHint').textContent = targetToken
        ? `Esta demo mostrará el recorrido completo y cerrará sobre el participante objetivo configurado: ${targetToken}.`
        : 'La demostración recorrerá todas las chances visibles y se detendrá automáticamente al finalizar.';
      tick();
    }

    function reset() {
      stop();
      state.paused = true;
      state.hasStarted = false;
      prepareRound();
      updateControls();
      if (!state.cycle.length) {
        renderEmpty();
        return;
      }
      render(state.cycle[0], false);
    }

    function toggleShowcase() {
      const showcase = document.getElementById('drawShowcase');
      const button = document.getElementById('toggleDemoBtn');
      if (!showcase || !button) return;
      const willOpen = showcase.classList.contains('collapsed');
      showcase.classList.toggle('collapsed', !willOpen);
      button.textContent = willOpen ? 'Ocultar demostracion' : 'Iniciar demostracion';
    }

    function toggleHistory() {
      state.historyOpen = !state.historyOpen;
      const panel = document.getElementById('demoHistoryPanel');
      const button = document.getElementById('toggleDemoHistoryBtn');
      panel?.classList.toggle('open', state.historyOpen);
      if (button) {
        button.textContent = state.historyOpen ? 'Ocultar participantes demo' : 'Participantes demostracion';
      }
    }

    function renderHistory(results) {
      const grid = document.getElementById('demoHistoryGrid');
      if (!grid) return;
      if (!results.length) {
        grid.innerHTML = '<div class="demo-history-empty">Todavia no hay resultados de demostracion guardados.</div>';
        return;
      }
      grid.innerHTML = results.map((item) => `
        <div class="demo-history-card">
          <strong>${escapeHtml(item.display_name || item.full_name || 'Participante')}</strong>
          <div class="demo-history-meta">
            <span>${escapeHtml([item.city || '', item.province || ''].filter(Boolean).join(', ') || 'Argentina')}</span>
            <span>${escapeHtml(item.recorded_at_label || '')}</span>
          </div>
          <div class="demo-history-meta">
            <span>${escapeHtml(item.public_code || 'Registro demo')}</span>
            <span>x${Number(item.chances || 0).toLocaleString('es-AR')}</span>
          </div>
        </div>
      `).join('');
    }

    return {
      syncParticipants() {
        state.basePool = buildBasePool(getParticipants());
      },
      getActiveParticipant,
      updateControls,
      syncParticipantTableFocus,
      renderEmpty,
      pause,
      startTrial,
      stop,
      prepareRound,
      tick,
      reset,
      toggleShowcase,
      toggleHistory,
      renderHistory
    };
  }

  window.createDemoDrawController = createDemoDrawController;
})();
