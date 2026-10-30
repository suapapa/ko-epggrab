(() => {
  // 1. Hero Broadcast Control Fragment
  const heroChannels = [
    { provider: 'NAVER', id: '814582', name: 'KBS2', no: '7', cat: '지상파', selected: true },
    { provider: 'NAVER', id: '814588', name: 'MBC', no: '11', cat: '지상파', selected: true },
    { provider: 'NAVER', id: '814592', name: 'SBS', no: '6', cat: '지상파', selected: true },
    { provider: 'NAVER', id: '814595', name: 'EBS1', no: '10-1', cat: '지상파', selected: true },
    { provider: 'NAVER', id: '814597', name: '경인 KBS1', no: '9', cat: '지상파', selected: true },
    { provider: 'NAVER', id: '814599', name: 'OBS 경인TV', no: '8', cat: '지상파', selected: false },
    { provider: 'KT', id: '1', name: 'ENA', no: '1', cat: '드라마/버라이어티', selected: true },
    { provider: 'KT', id: '15', name: 'JTBC', no: '15', cat: '종합편성', selected: true },
    { provider: 'KT', id: '20', name: 'tvN', no: '3', cat: '오락/음악', selected: false },
    { provider: 'LG', id: '101', name: '채널A', no: '18', cat: '종합편성', selected: false },
    { provider: 'LG', id: '102', name: 'MBN', no: '16', cat: '종합편성', selected: false },
    { provider: 'WAVVE', id: 'K01', name: 'MBC 무한도전 클래식', no: '201', cat: '미분류', selected: false },
    { provider: 'SPOTV', id: 'SP1', name: 'SPOTV Prime', no: '110', cat: '스포츠', selected: true }
  ];

  const providerTotals = {
    ALL: 2250,
    NAVER: 472,
    KT: 309,
    LG: 347,
    WAVVE: 154,
    SPOTV: 5
  };

  let activeProvider = 'NAVER';
  let selectedOnly = false;

  const chListEl = document.getElementById('hero-ch-list');
  const providerRailEl = document.getElementById('hero-provider-rail');
  const filterSummaryEl = document.getElementById('hero-filter-summary');
  const kpiSelectedEl = document.getElementById('hero-kpi-selected');
  const kpiXmlEl = document.getElementById('hero-kpi-xml');
  const statusBadgeEl = document.getElementById('hero-status-badge');
  const statusTextEl = document.getElementById('hero-status-text');
  const btnSelectedOnly = document.getElementById('hero-btn-selected-only');
  const btnGenerate = document.getElementById('hero-btn-generate');
  const btnFetch = document.getElementById('hero-btn-fetch');

  function renderHeroConsole() {
    if (!chListEl || !providerRailEl) return;

    const totalSelected = heroChannels.filter((c) => c.selected).length;
    if (kpiSelectedEl) {
      kpiSelectedEl.textContent = `${totalSelected}개 채널 활성`;
    }

    providerRailEl.querySelectorAll('[data-prov]').forEach((btn) => {
      const prov = btn.getAttribute('data-prov');
      btn.classList.toggle('is-active', prov === activeProvider);
      const countSpan = btn.querySelector('.provider-count');
      if (countSpan) {
        const selCount = prov === 'ALL'
          ? totalSelected
          : heroChannels.filter((c) => c.provider === prov && c.selected).length;
        countSpan.textContent = `${selCount}/${providerTotals[prov] || 0}`;
      }
    });

    const filtered = heroChannels.filter((c) => {
      if (activeProvider !== 'ALL' && c.provider !== activeProvider) return false;
      if (selectedOnly && !c.selected) return false;
      return true;
    });

    const filteredSelected = filtered.filter((c) => c.selected).length;
    if (filterSummaryEl) {
      filterSummaryEl.textContent = `표시 ${filtered.length} · 선택 ${filteredSelected}`;
    }

    chListEl.innerHTML = '';
    filtered.forEach((ch) => {
      const li = document.createElement('li');
      li.className = 'ch-row' + (ch.selected ? ' is-selected' : '');
      li.setAttribute('role', 'checkbox');
      li.setAttribute('aria-checked', String(ch.selected));
      li.tabIndex = 0;

      li.innerHTML = `
        <span class="ch-check" aria-hidden="true"><svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6l3 3 5-6"/></svg></span>
        <span class="ch-badge">${ch.provider.slice(0, 2)}</span>
        <span class="ch-name">${ch.name}</span>
        <span class="ch-cat">${ch.cat}</span>
        <code>${ch.id}</code>
      `;

      const toggle = () => {
        ch.selected = !ch.selected;
        renderHeroConsole();
      };
      li.addEventListener('click', toggle);
      li.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggle();
        }
      });
      chListEl.appendChild(li);
    });
  }

  if (providerRailEl) {
    providerRailEl.querySelectorAll('[data-prov]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeProvider = btn.getAttribute('data-prov') || 'NAVER';
        renderHeroConsole();
      });
    });
  }

  if (btnSelectedOnly) {
    btnSelectedOnly.addEventListener('click', () => {
      selectedOnly = !selectedOnly;
      btnSelectedOnly.setAttribute('aria-pressed', String(selectedOnly));
      renderHeroConsole();
    });
  }

  const runActionSimulation = (label, doneXmlText) => {
    if (!statusBadgeEl || !statusTextEl) return;
    statusBadgeEl.classList.add('is-busy');
    statusTextEl.textContent = label;
    setTimeout(() => {
      statusBadgeEl.classList.remove('is-busy');
      statusTextEl.textContent = '대기 중';
      if (doneXmlText && kpiXmlEl) {
        kpiXmlEl.textContent = doneXmlText;
      }
    }, 750);
  };

  if (btnGenerate) {
    btnGenerate.addEventListener('click', () => {
      const selCount = heroChannels.filter((c) => c.selected).length;
      const kb = (selCount * 27.6).toFixed(1);
      runActionSimulation('XMLTV 생성 및 소켓 전송 중', `${kb} KB (방금 전)`);
    });
  }

  if (btnFetch) {
    btnFetch.addEventListener('click', () => {
      runActionSimulation('채널 DB 갱신 중', null);
    });
  }

  renderHeroConsole();

  // 2. Showcase Live Thing: Input Half -> Output Half
  const showcaseCatalog = [
    { key: 'NAVER:814581', provider: 'NAVER', id: '814581', no: '9', name: 'KBS1', cat: '지상파', icon: 'https://epg.naver.com/icon/kbs1.png', program: 'KBS 뉴스 9', ep: '1420', desc: '오늘의 주요 뉴스와 심층 리포트', rebroadcast: false },
    { key: 'NAVER:814582', provider: 'NAVER', id: '814582', no: '7', name: 'KBS2', cat: '지상파', icon: 'https://epg.naver.com/icon/kbs2.png', program: '개그콘서트', ep: '1104', desc: '공개 코미디 무대', rebroadcast: true },
    { key: 'NAVER:814588', provider: 'NAVER', id: '814588', no: '11', name: 'MBC', cat: '지상파', icon: 'https://epg.naver.com/icon/mbc.png', program: '나 혼자 산다', ep: '568', desc: '1인 가구 스타들의 일상 관찰 예능', rebroadcast: false },
    { key: 'NAVER:814592', provider: 'NAVER', id: '814592', no: '6', name: 'SBS', cat: '지상파', icon: 'https://epg.naver.com/icon/sbs.png', program: '그것이 알고싶다', ep: '1418', desc: '사회 탐사 보도 프로그램', rebroadcast: false },
    { key: 'KT:1', provider: 'KT', id: '1', no: '1', name: 'ENA', cat: '드라마/버라이어티', icon: 'https://tv.kt.com/icon/ena.png', program: '나는 SOLO', ep: '173', desc: '극사실주의 데이팅 프로그램', rebroadcast: true },
    { key: 'KT:15', provider: 'KT', id: '15', no: '15', name: 'JTBC', cat: '종합편성', icon: 'https://tv.kt.com/icon/jtbc.png', program: '최강야구', ep: '105', desc: '은퇴 프로야구 선수들의 도전', rebroadcast: false },
    { key: 'LG:3', provider: 'LG', id: '3', no: '3', name: 'tvN', cat: '오락/음악', icon: 'https://uplus.co.kr/icon/tvn.png', program: '유 퀴즈 온 더 블럭', ep: '267', desc: '길 위에서 만나는 사람 여행', rebroadcast: true },
    { key: 'SPOTV:SP1', provider: 'SPOTV', id: 'SP1', no: '110', name: 'SPOTV Prime', cat: '스포츠', icon: 'https://spotv.net/icon/prime.png', program: '프리미어리그 하이라이트', ep: '12', desc: '이번 라운드 주요 골 장면', rebroadcast: false }
  ];

  const showcaseSelected = new Set(['NAVER:814581', 'NAVER:814582', 'NAVER:814588', 'KT:1']);
  const showcaseOpts = {
    ADD_REBROADCAST_TO_TITLE: true,
    ADD_EPNUM_TO_TITLE: true,
    ADD_DESCRIPTION: true,
    ADD_CHANNEL_ICON: true
  };
  let activeOutputTab = 'ko-epggrab';

  const chipContainer = document.getElementById('showcase-chips');
  const optContainer = document.getElementById('showcase-options');
  const outputTabsEl = document.getElementById('showcase-output-tabs');
  const outputCodeEl = document.getElementById('showcase-code-output');
  const outputCopyBtn = document.getElementById('showcase-copy-btn');
  const showcaseCountEl = document.getElementById('showcase-selected-count');

  function formatOutputContent() {
    const chosen = showcaseCatalog.filter((c) => showcaseSelected.has(c.key));
    if (showcaseCountEl) {
      showcaseCountEl.textContent = `${chosen.length}개 채널 선택됨`;
    }

    if (activeOutputTab === 'ko-epggrab') {
      const grouped = {};
      chosen.forEach((c) => {
        if (!grouped[c.provider]) grouped[c.provider] = [];
        grouped[c.provider].push({
          Name: c.name,
          No: c.no,
          ServiceId: c.id,
          Category: c.cat
        });
      });
      const cfg = {
        cron_channel_fetch: '0 0 * * 1',
        cron_generate_xmltv: '0 */12 * * *',
        send_to_socket: true,
        epg2xml_global: {
          ENABLED: true,
          FETCH_LIMIT: 2,
          ID_FORMAT: '{ServiceId}.{Source.lower()}',
          ...showcaseOpts
        },
        selected_channels: grouped
      };
      return JSON.stringify(cfg, null, 2);
    }

    if (activeOutputTab === 'epg2xml') {
      const myChannels = chosen.map((c) => ({
        Source: c.provider,
        Id: c.id,
        Name: c.name,
        No: c.no,
        ServiceId: c.id,
        Category: c.cat,
        ...(showcaseOpts.ADD_CHANNEL_ICON ? { Icon_url: c.icon } : {})
      }));
      return JSON.stringify({
        GLOBAL: {
          ENABLED: true,
          FETCH_LIMIT: 2,
          ID_FORMAT: '{ServiceId}.{Source.lower()}',
          ...showcaseOpts
        },
        MY_CHANNELS: myChannels
      }, null, 2);
    }

    // xmltv.xml preview
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
      '<tv generator-info-name="ko-epggrab + epg2xml">'
    ];
    chosen.forEach((c) => {
      const xmlId = `${c.id}.${c.provider.toLowerCase()}`;
      lines.push(`  <channel id="${xmlId}">`);
      lines.push(`    <display-name>${c.name}</display-name>`);
      if (showcaseOpts.ADD_CHANNEL_ICON) {
        lines.push(`    <icon src="${c.icon}" />`);
      }
      lines.push('  </channel>');
    });
    chosen.slice(0, 3).forEach((c) => {
      const xmlId = `${c.id}.${c.provider.toLowerCase()}`;
      let title = c.program;
      if (showcaseOpts.ADD_EPNUM_TO_TITLE && c.ep) title += ` (${c.ep}회)`;
      if (showcaseOpts.ADD_REBROADCAST_TO_TITLE && c.rebroadcast) title += ' [재]';
      lines.push(`  <programme start="20261030210000 +0900" stop="20261030223000 +0900" channel="${xmlId}">`);
      lines.push(`    <title lang="ko">${title}</title>`);
      if (showcaseOpts.ADD_DESCRIPTION) {
        lines.push(`    <desc lang="ko">${c.desc}</desc>`);
      }
      lines.push('  </programme>');
    });
    lines.push('</tv>');
    return lines.join('\n');
  }

  function renderShowcase() {
    if (chipContainer) {
      chipContainer.querySelectorAll('[data-ch-key]').forEach((btn) => {
        const key = btn.getAttribute('data-ch-key');
        btn.setAttribute('aria-pressed', String(showcaseSelected.has(key)));
      });
    }
    if (optContainer) {
      optContainer.querySelectorAll('[data-opt]').forEach((btn) => {
        const opt = btn.getAttribute('data-opt');
        const on = !!showcaseOpts[opt];
        btn.setAttribute('aria-pressed', String(on));
        const ind = btn.querySelector('.switch-indicator');
        if (ind) ind.textContent = on ? '켜짐' : '꺼짐';
      });
    }
    if (outputTabsEl) {
      outputTabsEl.querySelectorAll('[data-out-tab]').forEach((btn) => {
        btn.setAttribute('aria-selected', String(btn.getAttribute('data-out-tab') === activeOutputTab));
      });
    }
    if (outputCodeEl) {
      outputCodeEl.textContent = formatOutputContent();
    }
  }

  if (chipContainer) {
    chipContainer.querySelectorAll('[data-ch-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-ch-key');
        if (!key) return;
        if (showcaseSelected.has(key) && showcaseSelected.size > 1) {
          showcaseSelected.delete(key);
        } else {
          showcaseSelected.add(key);
        }
        renderShowcase();
      });
    });
  }

  if (optContainer) {
    optContainer.querySelectorAll('[data-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const opt = btn.getAttribute('data-opt');
        if (!opt) return;
        showcaseOpts[opt] = !showcaseOpts[opt];
        renderShowcase();
      });
    });
  }

  if (outputTabsEl) {
    outputTabsEl.querySelectorAll('[data-out-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeOutputTab = btn.getAttribute('data-out-tab') || 'ko-epggrab';
        renderShowcase();
      });
    });
  }

  if (outputCopyBtn) {
    outputCopyBtn.addEventListener('click', () => {
      const text = formatOutputContent();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      const prev = outputCopyBtn.textContent;
      outputCopyBtn.textContent = '복사 완료';
      setTimeout(() => {
        outputCopyBtn.textContent = prev;
      }, 1400);
    });
  }

  renderShowcase();

  // 3. How-it-works: Pinned fragment changing state
  const pipelineData = [
    {
      state: 'fetching_channels',
      badge: '채널 DB 갱신',
      command: 'os.Remove("/conf/epg2xml_channels.json") && epg2xml update_channels',
      target: '/conf/epg2xml_channels.json (11개 제공사 · 2,250개 채널)',
      mutex: 'workerMu.Lock() 단일 실행 보장',
      log: '[2026-10-30 00:00:01] Starting channel list update\n[2026-10-30 00:00:01] Removed stale /conf/epg2xml_channels.json\n[2026-10-30 00:00:04] Loaded KT(309), LG(347), SK(268), NAVER(472), DAUM(415), WAVVE(154)...\n[2026-10-30 00:00:05] Saved 2,250 channels successfully (took 4.1s)'
    },
    {
      state: 'sync_metadata',
      badge: '메타데이터 동기화',
      command: 'SyncAndWriteEPG2XMLConfig("/conf/ko-epggrab.json", "/conf/epg2xml.json")',
      target: '/conf/epg2xml.json (원자적 임시 파일 교체)',
      mutex: 'cfgMu.RLock() 스레드 안전 읽기',
      log: '[2026-10-30 12:00:00] Reading Single Source of Truth: /conf/ko-epggrab.json\n[2026-10-30 12:00:00] Matching Provider + ServiceId against latest epg2xml_channels.json\n[2026-10-30 12:00:00] Preserved Icon_url, Category, No for 18 selected channels\n[2026-10-30 12:00:00] Wrote /conf/epg2xml.json atomically'
    },
    {
      state: 'generating_xmltv',
      badge: 'XMLTV 생성 · UDS 전송',
      command: 'epg2xml run --xmlfile /epggrab/xmltv.xml -> unix:///epggrab/xmltv.sock',
      target: '/epggrab/xmltv.xml 및 Tvheadend xmltv.sock',
      mutex: 'net.Dial("unix", "/epggrab/xmltv.sock") 스트리밍',
      log: '[2026-10-30 12:00:01] Executing epg2xml run (FETCH_LIMIT=2 days)\n[2026-10-30 12:00:09] Generated /epggrab/xmltv.xml (1.42 MB, 1,284 programmes)\n[2026-10-30 12:00:09] Connected to Tvheadend socket /epggrab/xmltv.sock\n[2026-10-30 12:00:09] Streamed 1,489,120 bytes to xmltv.sock (status: OK)'
    }
  ];

  const stepItems = [...document.querySelectorAll('[data-pipeline-step]')];
  const monitorTabs = [...document.querySelectorAll('[data-monitor-tab]')];
  const monBadge = document.getElementById('mon-badge');
  const monCmd = document.getElementById('mon-cmd');
  const monTarget = document.getElementById('mon-target');
  const monMutex = document.getElementById('mon-mutex');
  const monLog = document.getElementById('mon-log');

  function setPipelineStep(idx) {
    const item = pipelineData[idx] || pipelineData[0];
    stepItems.forEach((el, i) => el.classList.toggle('is-active', i === idx));
    monitorTabs.forEach((el, i) => el.classList.toggle('is-active', i === idx));
    if (monBadge) monBadge.textContent = item.badge;
    if (monCmd) monCmd.textContent = item.command;
    if (monTarget) monTarget.textContent = item.target;
    if (monMutex) monMutex.textContent = item.mutex;
    if (monLog) monLog.textContent = item.log;
  }

  stepItems.forEach((el, i) => {
    el.addEventListener('click', () => setPipelineStep(i));
  });
  monitorTabs.forEach((el, i) => {
    el.addEventListener('click', () => setPipelineStep(i));
  });

  if (stepItems.length && 'IntersectionObserver' in window) {
    const stepObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = stepItems.indexOf(entry.target);
          if (idx !== -1) setPipelineStep(idx);
        }
      });
    }, { rootMargin: '-35% 0px -45% 0px', threshold: 0.1 });
    stepItems.forEach((el) => stepObserver.observe(el));
  }

  // 4. Features: Cron Preset Switcher
  const cronButtons = [...document.querySelectorAll('[data-cron-val]')];
  const cronCodeEl = document.getElementById('feature-cron-code');
  const cronNextEl = document.getElementById('feature-cron-next');

  cronButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      cronButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      if (cronCodeEl) cronCodeEl.textContent = btn.getAttribute('data-cron-val') || '0 */12 * * *';
      if (cronNextEl) cronNextEl.textContent = btn.getAttribute('data-cron-next') || '다음 실행: 오늘 24:00';
    });
  });

  // 5. CTA: Interactive Docker Compose Builder
  const portInput = document.getElementById('cta-port-input');
  const cronSelect = document.getElementById('cta-cron-select');
  const recInput = document.getElementById('cta-rec-input');
  const composePre = document.getElementById('cta-compose-pre');
  const copyComposeBtn = document.getElementById('cta-copy-compose');

  function buildComposeText() {
    const port = (portInput && portInput.value.trim()) || '8080';
    const cron = (cronSelect && cronSelect.value) || '0 */12 * * *';
    const rec = (recInput && recInput.value.trim()) || './tvheadend_recording';
    return `services:
  tvheadend:
    image: lscr.io/linuxserver/tvheadend:latest
    container_name: tvheadend
    environment:
      - PUID=0
      - PGID=0
      - TZ=Asia/Seoul
    volumes:
      - tvheadend_config:/config
      - epggrab_data:/config/epggrab
      - ${rec}:/recordings
    network_mode: "host"
    restart: unless-stopped

  ko-epggrab:
    image: ghcr.io/suapapa/ko-epggrab:latest
    container_name: ko-epggrab
    ports:
      - "${port}:8080"
    environment:
      - CRON_GENERATE_XMLTV=${cron}
    volumes:
      - ko_epggrab_conf:/conf
      - epggrab_data:/epggrab
    restart: unless-stopped

volumes:
  tvheadend_config:
  epggrab_data:
  ko_epggrab_conf:`;
  }

  function updateComposePreview() {
    if (composePre) {
      composePre.textContent = buildComposeText();
    }
  }

  [portInput, cronSelect, recInput].forEach((el) => {
    if (el) el.addEventListener('input', updateComposePreview);
    if (el) el.addEventListener('change', updateComposePreview);
  });

  if (copyComposeBtn) {
    copyComposeBtn.addEventListener('click', () => {
      const text = buildComposeText();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      const prev = copyComposeBtn.textContent;
      copyComposeBtn.textContent = 'docker-compose.yml 복사됨';
      setTimeout(() => {
        copyComposeBtn.textContent = prev;
      }, 1500);
    });
  }

  updateComposePreview();

  // 6. Scroll Reveal & Shutter & Video Observer
  if ('IntersectionObserver' in window) {
    const revealTargets = document.querySelectorAll('[data-reveal], .shutter');
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });

    revealTargets.forEach((el) => revealObserver.observe(el));
    setTimeout(() => {
      revealTargets.forEach((el) => el.classList.add('is-in'));
    }, 900);

    const calm = matchMedia('(prefers-reduced-motion: reduce)');
    const clips = [...document.querySelectorAll('video[autoplay]')];
    const inView = new Set();
    const syncVideo = (v) => {
      if (calm.matches) return;
      if (inView.has(v)) v.play().catch(() => {});
      else v.pause();
    };
    const settleVideos = () => {
      clips.forEach((v) => {
        if (calm.matches) {
          v.removeAttribute('autoplay');
          v.pause();
        } else if (inView.has(v)) {
          v.play().catch(() => {});
        }
      });
    };
    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) inView.add(e.target);
        else inView.delete(e.target);
        syncVideo(e.target);
      });
    }, { threshold: 0.2 });

    clips.forEach((v) => videoObserver.observe(v));
    settleVideos();
    calm.addEventListener('change', settleVideos);
  }
})();
