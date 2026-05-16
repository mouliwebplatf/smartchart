// src/app/debug/storage-debug.util.ts

export function runStorageDebug(): void {

  const SEP = '─'.repeat(60);

  function sizeKB(str: string): string {
    return (str.length / 1024).toFixed(2) + ' KB';
  }

  function tsToDate(ts: number): string {
    if (!ts) return 'N/A';
    return new Date(ts * 1000).toISOString().split('T')[0];
  }

  console.log('\n' + SEP);
  console.log('        LOCALSTORAGE DEBUG REPORT');
  console.log(SEP);

  // ── 1. All keys overview ─────────────────────────────────────
  console.log('\n📦 ALL KEYS:\n');
  const keyData: any[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    const raw = localStorage.getItem(key)!;
    keyData.push({ key, size: sizeKB(raw), characters: raw.length });
  }
  console.table(keyData);

  // ── 2. TESTS ─────────────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('📋 TESTS  (key: "tests")\n');

  const testsRaw = localStorage.getItem('tests');
  if (!testsRaw) {
    console.warn('  ❌ "tests" key not found');
  } else {
    const testsData = JSON.parse(testsRaw);
    console.log('  version     :', testsData.version);
    console.log('  lastUpdated :', testsData.lastUpdated);
    console.log('  total tests :', testsData.tests?.length ?? 0);
    console.log('');

    if (testsData.tests?.length) {
      console.table(
        testsData.tests.map((t: any) => ({
          id          : t.id,
          name        : t.name,
          symbol      : t.symbol,
          timeframe   : t.timeframe,
          difficulty  : t.difficulty,
          status      : t.status,
          candleCount : t.data?.length ?? 0,
          firstCandle : tsToDate(t.data?.[0]?.time),
          lastCandle  : tsToDate(t.data?.[t.data.length - 1]?.time),
          sizeKB      : sizeKB(JSON.stringify(t))
        }))
      );

      testsData.tests.forEach((t: any) => {
        console.log(`\n  📊 Test ID=${t.id} "${t.name}" — first 2 candles:`);
        console.table(
          (t.data ?? []).slice(0, 2).map((c: any) => ({
            date      : tsToDate(c.time),
            timestamp : c.time,
            open      : c.open,
            high      : c.high,
            low       : c.low,
            close     : c.close,
            volume    : c.volume ?? 0
          }))
        );
      });
    }
  }

  // ── 3. DRAWING DATA ──────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('✏️  DRAWING DATA  (key: "drawing_data")\n');

  const drawRaw = localStorage.getItem('drawing_data');
  if (!drawRaw) {
    console.warn('  ❌ "drawing_data" key not found');
  } else {
    const drawData = JSON.parse(drawRaw);
    const adminLines = drawData.adminLines ?? [];
    console.log('  Total testIds with admin lines:', adminLines.length);

    adminLines.forEach(([testId, lines]: [number, any[]]) => {
      console.log(`\n  🔑 testId=${testId}  |  admin lines: ${lines.length}`);
      if (lines.length === 0) {
        console.log('     (no lines)');
        return;
      }
      console.table(
        lines.map((l: any) => ({
          id            : l.id.substring(0, 8) + '…',
          fullId        : l.id,
          type          : l.type,
          tool          : l.tool,
          startDate     : tsToDate(l.startTime),
          endDate       : tsToDate(l.endTime),
          startPrice    : l.startPrice,
          endPrice      : l.endPrice,
          color         : l.color,
          parentId      : l.parentId ?? 'none',
          createdAt     : l.createdAt
        }))
      );
    });
  }

  // ── 4. SIZE SUMMARY ──────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('💾 SIZE SUMMARY\n');

  let totalChars = 0;
  const sizeRows: any[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    const raw = localStorage.getItem(key)!;
    totalChars += raw.length;
    sizeRows.push({ key, sizeKB: sizeKB(raw), characters: raw.length });
  }
  sizeRows.forEach(r => {
    r.percentOfTotal = ((r.characters / totalChars) * 100).toFixed(1) + '%';
  });
  console.table(sizeRows);
  console.log(`  Total used : ${(totalChars / 1024).toFixed(2)} KB`);
  console.log(`  Browser limit : ~5120 KB`);
  console.log(`  Used : ${((totalChars / 1024 / 5120) * 100).toFixed(1)}% of limit`);
  console.log('\n' + SEP + '\n');
}


export function exportStorageToFile(): void {
  const data: Record<string, any> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    try { data[key] = JSON.parse(localStorage.getItem(key)!); }
    catch { data[key] = localStorage.getItem(key); }
  }
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `localstorage_dump_${Date.now()}.json`;
  a.click();
}