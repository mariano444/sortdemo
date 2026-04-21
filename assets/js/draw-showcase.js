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

    const MAX_DEMO_DURATION_MS = 118000;
    const MIN_DEMO_DURATION_MS = 12000;
    const MAX_DEMO_STEPS = 180;

    let animationTimeout = null;
    let lastFocusedIndex = -1;
    let focusPulse = 0;
    let lastRenderedIndex = -1;
    let lastHopDistance = 0;
    let participantStreak = 0;
    let demoStartedAt = 0;

    let mediaRecorder = null;
    let mediaStream = null;
    let recordingChunks = [];
    let recordingBlob = null;
    let recordingMimeType = 'video/webm';
    let recordingUrl = '';
    let previewOpen = false;
    let liveAudience = 120;
    let liveAudienceInterval = null;

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
          participant?.source,
          participant?.seed,
          participant?.originalSource,
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

    function limitCycleSize(cycle, finalEntry) {
      if (cycle.length <= MAX_DEMO_STEPS) {
        return cycle;
      }

      const sampleSize = Math.max(24, MAX_DEMO_STEPS - (finalEntry ? 1 : 0));
      const result = [];
      const lastIndex = Math.max(cycle.length - (finalEntry ? 2 : 1), 0);

      for (let step = 0; step < sampleSize; step += 1) {
        const progress = sampleSize <= 1 ? 0 : step / (sampleSize - 1);
        const index = Math.min(lastIndex, Math.floor(progress * lastIndex));
        const entry = cycle[index];
        if (!entry) continue;
        const prev = result[result.length - 1];
        if (!prev || prev.participantIndex !== entry.participantIndex || prev.chanceNumber !== entry.chanceNumber) {
          result.push(entry);
        }
      }

      let cursor = 0;
      while (result.length < sampleSize && cursor < cycle.length) {
        const entry = cycle[cursor];
        const exists = result.some((item) => (
          item.participantIndex === entry.participantIndex && item.chanceNumber === entry.chanceNumber
        ));
        if (!exists && (!finalEntry || entry !== finalEntry)) {
          result.push(entry);
        }
        cursor += 1;
      }

      if (finalEntry) {
        const filtered = result.filter((item) => !(
          item.participantIndex === finalEntry.participantIndex && item.chanceNumber === finalEntry.chanceNumber
        ));
        filtered.push(finalEntry);
        return filtered;
      }

      return result;
    }

    function getBurstSize(queueLength, sameParticipant, nearFinish) {
      if (sameParticipant) return 1;
      if (nearFinish) return Math.min(queueLength, queueLength > 20 ? 4 : 2);
      if (queueLength > 1000) return Math.min(queueLength, 26);
      if (queueLength > 250) return Math.min(queueLength, 18);
      if (queueLength > 100) return Math.min(queueLength, 12);
      if (queueLength > 40) return Math.min(queueLength, 7);
      if (queueLength > 20) return Math.min(queueLength, 5);
      return Math.min(queueLength, Math.random() > 0.7 ? 3 : Math.random() > 0.4 ? 2 : 1);
    }

    function weightedPick(candidates) {
      const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
      if (!totalWeight) return candidates[0] || null;
      let cursor = Math.random() * totalWeight;
      for (const candidate of candidates) {
        cursor -= candidate.weight;
        if (cursor <= 0) return candidate;
      }
      return candidates[candidates.length - 1] || null;
    }

    function getTargetDurationMs(totalEntries) {
      if (totalEntries <= 20) {
        return Math.max(MIN_DEMO_DURATION_MS, 9000 + (totalEntries * 320));
      }
      if (totalEntries <= 100) {
        return 13000 + (totalEntries * 55);
      }
      if (totalEntries <= 1000) {
        return 22000 + (totalEntries * 12);
      }
      return Math.min(MAX_DEMO_DURATION_MS, 58000 + Math.min((totalEntries - 1000) * 3, 24000));
    }

    function setRecordingState(message) {
      const label = document.getElementById('drawRecordingState');
      if (label) {
        label.textContent = message;
      }
    }

    function stopLiveAudienceAnimation() {
      if (liveAudienceInterval) {
        clearInterval(liveAudienceInterval);
        liveAudienceInterval = null;
      }
    }

    function setLiveBadge(isRecording) {
      const badge = document.getElementById('drawLiveBadge');
      if (!badge) return;
      badge.textContent = isRecording ? `${liveAudience} en vivo · grabando` : `${liveAudience} en vivo`;
    }

    function animateLiveAudience(target = 190) {
      stopLiveAudienceAnimation();
      const finalTarget = Math.max(120, Number(target) || 190);
      if (liveAudience >= finalTarget) {
        liveAudience = finalTarget;
        setLiveBadge(Boolean(mediaRecorder && mediaRecorder.state === 'recording'));
        return;
      }

      liveAudienceInterval = window.setInterval(() => {
        if (liveAudience >= finalTarget) {
          stopLiveAudienceAnimation();
          return;
        }
        liveAudience += Math.max(1, Math.ceil((finalTarget - liveAudience) / 9));
        if (liveAudience > finalTarget) {
          liveAudience = finalTarget;
        }
        setLiveBadge(Boolean(mediaRecorder && mediaRecorder.state === 'recording'));
      }, 900);
    }

    function updateVideoPanel() {
      const panel = document.getElementById('demoVideoPanel');
      const preview = document.getElementById('demoVideoPreview');
      const download = document.getElementById('demoVideoDownloadBtn');
      const viewBtn = document.getElementById('viewDemoVideoBtn');

      if (preview) {
        preview.src = recordingUrl || '';
      }
      if (download) {
        download.href = recordingUrl || '#';
        download.style.pointerEvents = recordingUrl ? 'auto' : 'none';
        download.style.opacity = recordingUrl ? '1' : '0.45';
      }
      if (viewBtn) {
        viewBtn.disabled = !recordingUrl;
        viewBtn.style.opacity = recordingUrl ? '1' : '0.45';
      }
      panel?.classList.toggle('open', Boolean(recordingUrl) && previewOpen);
    }

    function closeMediaStream() {
      if (!mediaStream) return;
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    function stopRecording() {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        return;
      }
      closeMediaStream();
      setLiveBadge(false);
    }

    async function startRecording() {
      if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
        showToast('Tu navegador no permite grabar la pestaña desde esta demo.');
        return false;
      }

      if (mediaRecorder && mediaRecorder.state === 'recording') {
        showToast('La grabacion ya esta en curso.');
        return true;
      }

      try {
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: 30
          },
          audio: false,
          preferCurrentTab: true
        });

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
            ? 'video/webm;codecs=vp8'
            : 'video/webm';

        recordingChunks = [];
        recordingBlob = null;
        recordingMimeType = mimeType;
        mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordingChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          if (recordingUrl) {
            URL.revokeObjectURL(recordingUrl);
          }
          if (recordingChunks.length) {
            recordingBlob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || recordingMimeType || 'video/webm' });
            recordingMimeType = mediaRecorder.mimeType || recordingMimeType || 'video/webm';
            recordingUrl = URL.createObjectURL(recordingBlob);
            previewOpen = true;
            updateVideoPanel();
            setRecordingState('Grabacion oficial lista para reproducir o guardar');
            showToast('La grabacion oficial del sorteo quedo lista.');
          } else {
            setRecordingState('No se genero video en la grabacion');
          }
          closeMediaStream();
          setLiveBadge(false);
        };

        mediaStream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
              mediaRecorder.stop();
            }
          });
        });

        mediaRecorder.start(1000);
        setRecordingState('Grabando esta pestaña en tiempo real');
        animateLiveAudience(190);
        setLiveBadge(true);
        return true;
      } catch (_) {
        setRecordingState('No se pudo iniciar la grabacion');
        showToast('No se pudo iniciar la grabacion. Debes permitir compartir la pestaña actual.');
        return false;
      }
    }

    function buildControlledCycle() {
      const participants = getParticipants();
      const pool = buildBasePool(participants);
      state.basePool = pool;
      state.durationTargetMs = getTargetDurationMs(pool.length);

      if (!pool.length) {
        state.cycle = [];
        state.cyclePosition = 0;
        state.spotlightPosition = -1;
        state.finalEntry = null;
        return;
      }

      const targetIndex = getTargetIndex(participants);
      const entryQueues = participants.map(() => []);
      pool.forEach((entry) => {
        if (entryQueues[entry.participantIndex]) {
          entryQueues[entry.participantIndex].push(entry);
        }
      });

      let finalEntry = null;
      if (targetIndex >= 0 && entryQueues[targetIndex]?.length) {
        finalEntry = entryQueues[targetIndex].pop() || null;
      }

      const cycle = [];
      const visitedParticipants = new Set();
      let lastParticipantIndex = -1;
      let sameParticipantStreak = 0;
      let remainingEntries = entryQueues.reduce((sum, queue) => sum + queue.length, 0);

      while (remainingEntries > 0) {
        const available = entryQueues
          .map((queue, participantIndex) => ({ participantIndex, queue }))
          .filter(({ queue }) => queue.length);

        if (!available.length) break;

        const candidates = available.map(({ participantIndex, queue }) => {
          const distance = lastParticipantIndex < 0 ? 2 : Math.abs(participantIndex - lastParticipantIndex);
          let weight = 1
            + Math.min(queue.length, 7) * 0.22
            + Math.min(distance, 10) * 0.14
            + Math.random() * 0.8;

          if (participantIndex !== lastParticipantIndex) weight += 1.4;
          if (!visitedParticipants.has(participantIndex)) weight += 1.2;
          if (participantIndex === lastParticipantIndex && available.length > 1) {
            weight *= sameParticipantStreak >= 1 ? 0.1 : 0.35;
          }
          if (participantIndex === targetIndex && remainingEntries > 18) weight *= 0.08;
          if (participantIndex === targetIndex && remainingEntries <= 18) weight += 0.85;
          return { participantIndex, weight };
        });

        const selected = weightedPick(candidates);
        if (!selected) break;

        const selectedQueue = entryQueues[selected.participantIndex];
        const nearFinish = remainingEntries <= 14;
        const burstSize = getBurstSize(
          selectedQueue.length,
          selected.participantIndex === lastParticipantIndex,
          nearFinish
        );

        for (let step = 0; step < burstSize; step += 1) {
          const nextEntry = selectedQueue.shift();
          if (!nextEntry) break;
          cycle.push(nextEntry);
          remainingEntries -= 1;
        }

        if (selected.participantIndex === lastParticipantIndex) {
          sameParticipantStreak += 1;
        } else {
          sameParticipantStreak = 0;
        }
        lastParticipantIndex = selected.participantIndex;
        visitedParticipants.add(selected.participantIndex);
      }

      if (finalEntry) {
        cycle.push(finalEntry);
      }

      state.cycle = limitCycleSize(cycle, finalEntry);
      state.cyclePosition = 0;
      state.spotlightPosition = state.cycle.length ? state.cycle.length - 1 : -1;
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
      const recordBtn = document.getElementById('recordDemoBtn');
      const viewBtn = document.getElementById('viewDemoVideoBtn');

      if (!showcase || !startBtn || !saveBtn) return;
      showcase.classList.toggle('paused', state.paused);

      startBtn.disabled = !getParticipants().length || state.hasStarted;
      startBtn.style.opacity = startBtn.disabled ? '0.5' : '1';

      saveBtn.disabled = !getActiveParticipant() || !state.paused || !state.hasStarted;
      saveBtn.style.opacity = saveBtn.disabled ? '0.5' : '1';

      if (recordBtn) {
        const isRecording = mediaRecorder && mediaRecorder.state === 'recording';
        recordBtn.disabled = !getParticipants().length || isRecording;
        recordBtn.style.opacity = recordBtn.disabled ? '0.5' : '1';
        recordBtn.textContent = isRecording ? 'Grabando demo...' : 'Grabar demo';
      }

      if (viewBtn) {
        viewBtn.disabled = !recordingUrl;
        viewBtn.style.opacity = recordingUrl ? '1' : '0.45';
      }
    }

    function syncParticipantTableFocus(activeIndex, isSpotlight) {
      const rows = document.querySelectorAll('.participant-main-row');
      if (!state.hasStarted) {
        rows.forEach((row) => {
          row.classList.remove('is-draw-active', 'is-draw-spotlight');
        });
        document.getElementById('drawShowcase')?.classList.remove('is-focus-locked');
        lastFocusedIndex = -1;
        focusPulse = 0;
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
      const focusChanged = activeIndex !== lastFocusedIndex;

      if (focusChanged) {
        focusPulse += 1;
      }

      if (shouldLockView || rowTop < visibleTop || rowBottom > visibleBottom || focusChanged) {
        const anchorPattern = isSpotlight ? 0.5 : [0.22, 0.57, 0.36, 0.66][focusPulse % 4];
        const targetTop = Math.max(
          0,
          rowTop - (scroller.clientHeight * anchorPattern) + (activeRow.offsetHeight * 0.5)
        );
        scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
      }

      if (shouldLockView) {
        document.getElementById('drawShowcase')?.classList.add('is-focus-locked');
      }
      lastFocusedIndex = activeIndex;
    }

    function getNarrative(participant, isSpotlight, cycleProgress) {
      if (isSpotlight) {
        return 'El sorteo completó el recorrido dinámico y fijó el cierre sobre el participante seleccionado.';
      }
      if (cycleProgress < 0.16) {
        return 'El sorteo arrancó con una muestra ágil de la urna para que el seguimiento se sienta dinámico y claro.';
      }
      if (cycleProgress < 0.72) {
        return `La muestra sigue mezclando focos y bloques cortos de chances para ${participant.displayName || participant.name}.`;
      }
      return 'La muestra entra en el tramo final, acelera el cierre y deja el foco listo para el ganador configurado.';
    }

    function getDelay(participant, isSpotlight) {
      const remainingSteps = Math.max(1, state.cycle.length - state.cyclePosition);
      const elapsed = demoStartedAt ? Date.now() - demoStartedAt : 0;
      const remainingDuration = Math.max(1200, (state.durationTargetMs || MAX_DEMO_DURATION_MS) - elapsed);
      const baseline = remainingDuration / remainingSteps;
      const chanceWeight = Math.min(getParticipantChances(participant), 25);
      const motionBoost = Math.min(lastHopDistance, 12) * 6;
      const streakPenalty = participantStreak > 1 ? 14 + (participantStreak * 6) : 0;
      const progress = state.cycle.length ? state.cyclePosition / state.cycle.length : 0;
      const densityBoost = Math.min(state.cycle.length, 3000) / 125;
      const bigChanceBoost = chanceWeight > 20 ? Math.min(32, (chanceWeight - 20) * 1.8) : 0;

      if (isSpotlight) {
        return Math.min(1800, Math.max(850, remainingDuration));
      }

      return Math.max(
        8,
        Math.min(
          120,
          baseline
            - motionBoost
            + streakPenalty
            + (chanceWeight * 0.6)
            - densityBoost
            - bigChanceBoost
            + (progress < 0.12 ? -24 : 0)
            + (progress > 0.85 ? -18 : 0)
            + Math.random() * 10
        )
      );
    }

    function renderEmpty() {
      stop();
      state.activeParticipantIndex = -1;
      state.activeEntryNumber = 0;
      state.activeEntryPosition = 0;
      state.activeSpotlight = false;
      state.hasStarted = false;
      state.paused = true;
      state.durationTargetMs = 0;
      lastRenderedIndex = -1;
      lastHopDistance = 0;
      participantStreak = 0;
      demoStartedAt = 0;
      document.getElementById('drawShowcase')?.classList.remove('is-focus-locked');
      document.getElementById('drawFeaturedCard')?.classList.remove('spotlight');
      syncParticipantTableFocus(-1, false);
      document.getElementById('drawRoundCounter').textContent = '0';
      document.getElementById('drawFeaturedAvatar').textContent = '--';
      document.getElementById('drawFeaturedAvatar').style.background = 'rgba(255,255,255,0.06)';
      document.getElementById('drawFeaturedAvatar').style.color = 'var(--text)';
      document.getElementById('drawFeaturedName').textContent = 'La animacion se activara sola';
      document.getElementById('drawFeaturedMeta').innerHTML = '<span class="draw-featured-pill">Sin datos todavia</span>';
      document.getElementById('drawFeaturedScore').textContent = '0';
      document.getElementById('drawPhaseLabel').textContent = 'Demo lista';
      document.getElementById('drawPhaseName').textContent = 'Esperando participantes para mostrar el recorrido';
      document.getElementById('drawPhaseHint').textContent = 'Cuando haya participantes visibles, el sorteo recorrerá la urna antes de cerrar el resultado oficial.';
      document.getElementById('drawIntelFill').style.width = '14%';
      setRecordingState(recordingUrl ? 'Grabacion lista para reproducir o descargar' : 'Listo para grabar en esta pestaña');
      setLiveBadge(Boolean(mediaRecorder && mediaRecorder.state === 'recording'));
      const rail = document.getElementById('drawRail');
      if (rail) {
        rail.innerHTML = '<div class="draw-rail-empty">Todavia no hay participantes visibles para iniciar el recorrido animado.</div>';
      }
      updateControls();
      updateVideoPanel();
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

      const cycleProgress = state.cycle.length ? (state.cyclePosition + 1) / state.cycle.length : 0;
      const activeColor = colorFor(entry.participantIndex);

      if (lastRenderedIndex === entry.participantIndex) {
        participantStreak += 1;
      } else {
        participantStreak = 1;
      }
      lastHopDistance = lastRenderedIndex < 0 ? 0 : Math.abs(entry.participantIndex - lastRenderedIndex);
      lastRenderedIndex = entry.participantIndex;

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
      document.getElementById('drawPhaseLabel').textContent = isSpotlight ? 'Resultado oficial' : 'Recorrido en vivo';
      document.getElementById('drawPhaseName').textContent = isSpotlight
        ? `${participant.displayName || participant.name} quedó seleccionado como ganador`
        : `Saltando por ${state.activeEntryPosition.toLocaleString('es-AR')} de ${state.cycle.length.toLocaleString('es-AR')} focos de muestra`;
      document.getElementById('drawPhaseHint').textContent = getNarrative(participant, isSpotlight, cycleProgress);
      document.getElementById('drawIntelFill').style.width = `${Math.max(14, Math.min(100, cycleProgress * 100))}%`;

      const visibleCards = [];
      const rail = document.getElementById('drawRail');
      const cardCount = Math.min(Math.max(state.cycle.length, 1), 7);
      const previewStart = Math.max(0, state.cyclePosition - 2);
      for (let offset = 0; offset < cardCount; offset += 1) {
        const cyclePosition = Math.min(previewStart + offset, state.cycle.length - 1);
        const cycleEntry = state.cycle[cyclePosition];
        const item = participants[cycleEntry?.participantIndex];
        if (!cycleEntry || !item) continue;
        visibleCards.push(`
          <div class="draw-rail-card${cyclePosition === state.cyclePosition ? ' active' : ''}${cyclePosition === state.spotlightPosition ? ' spotlight' : ''}">
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
      document.getElementById('drawPhaseLabel').textContent = 'Sorteo finalizado';
      document.getElementById('drawPhaseName').textContent = 'El sorteo completó el recorrido y fijó al participante ganador';
      document.getElementById('drawPhaseHint').textContent = targetToken
        ? `El cierre quedó anclado al participante objetivo ${targetToken}.`
        : 'Ahora puedes guardar este resultado oficial junto con el video del sorteo.';

      if (mediaRecorder && mediaRecorder.state === 'recording') {
        window.setTimeout(() => {
          stopRecording();
        }, 650);
      }
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
          showToast(`Sorteo finalizado. Ganador seleccionado: ${participant.displayName || participant.name}.`);
        }, delay);
        return;
      }

      animationTimeout = setTimeout(() => {
        tick();
      }, delay);
    }

    function beginTrialPlayback() {
      if (!getParticipants().length) {
        renderEmpty();
        return;
      }
      state.hasStarted = true;
      state.paused = false;
      lastRenderedIndex = -1;
      lastHopDistance = 0;
      participantStreak = 0;
      prepareRound();
      demoStartedAt = Date.now();
      updateControls();
      document.getElementById('participantsTableScroller')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      liveAudience = 120;
      animateLiveAudience(190);
      document.getElementById('drawPhaseLabel').textContent = 'Sorteo en curso';
      document.getElementById('drawPhaseName').textContent = 'El sistema está recorriendo en vivo todas las chances activas';
      document.getElementById('drawPhaseHint').textContent = targetToken
        ? `Este sorteo terminará sobre el participante objetivo: ${targetToken}.`
        : 'El sorteo recorrerá una muestra dinámica de la urna y se detendrá automáticamente al finalizar.';
      tick();
    }

    async function startTrial() {
      if (!getParticipants().length) {
        renderEmpty();
        return;
      }
      if (!mediaRecorder || mediaRecorder.state !== 'recording') {
        await startRecording();
      }
      beginTrialPlayback();
    }

    async function recordTrial() {
      if (!getParticipants().length) {
        renderEmpty();
        return;
      }
      if (!mediaRecorder || mediaRecorder.state !== 'recording') {
        const started = await startRecording();
        if (!started) return;
      }
      beginTrialPlayback();
    }

    function reset() {
      stop();
      state.paused = true;
      state.hasStarted = false;
      state.durationTargetMs = 0;
      lastRenderedIndex = -1;
      lastHopDistance = 0;
      participantStreak = 0;
      demoStartedAt = 0;
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
      button.textContent = willOpen ? 'Ocultar sorteo oficial' : 'Mostrar sorteo oficial';
    }

    function toggleHistory() {
      state.historyOpen = !state.historyOpen;
      const panel = document.getElementById('demoHistoryPanel');
      const button = document.getElementById('toggleDemoHistoryBtn');
      panel?.classList.toggle('open', state.historyOpen);
      if (button) {
        button.textContent = state.historyOpen ? 'Ocultar ganadores guardados' : 'Ganadores guardados';
      }
    }

    function toggleVideoPanel() {
      if (!recordingUrl) {
        showToast('Todavía no hay un video grabado para mostrar.');
        return;
      }
      previewOpen = !previewOpen;
      updateVideoPanel();
    }

    function renderHistory(results) {
      const grid = document.getElementById('demoHistoryGrid');
      if (!grid) return;
      if (!results.length) {
        grid.innerHTML = '<div class="demo-history-empty">Todavía no hay resultados oficiales guardados.</div>';
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
      recordTrial,
      stop,
      prepareRound,
      tick,
      reset,
      toggleShowcase,
      toggleHistory,
      toggleVideoPanel,
      renderHistory,
      getRecordingBlob() {
        return recordingBlob;
      },
      getRecordingUrl() {
        return recordingUrl;
      },
      getRecordingMimeType() {
        return recordingMimeType || 'video/webm';
      }
    };
  }

  window.createDemoDrawController = createDemoDrawController;
})();
