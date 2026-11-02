// node:test reporter for the acceptance runner: one JSON line per finished test with its file and parent test.
// The built-in JUnit reporter only writes the `file` attribute on Node ≥ 23, so on the pinned Node 22 every mapped
// test looked unmatched (MAP_DRIFT). Reporter events carry `data.file` on every supported version.
module.exports = async function* acceptanceReporter(source) {
  const stacks = new Map(); // file → [{ name, children }] indexed by nesting
  for await (const event of source) {
    const data = event.data ?? {};
    if (event.type === 'test:start') {
      const stack = stacks.get(data.file) ?? [];
      stack.length = data.nesting;
      if (data.nesting > 0 && stack[data.nesting - 1]) stack[data.nesting - 1].children = true;
      stack.push({ name: data.name, children: false });
      stacks.set(data.file, stack);
    } else if (event.type === 'test:pass' || event.type === 'test:fail') {
      const stack = stacks.get(data.file) ?? [];
      const self = stack[data.nesting]?.name === data.name ? stack[data.nesting] : null;
      yield JSON.stringify({
        file: data.file ?? null,
        name: data.name,
        parent: data.nesting > 0 ? stack[data.nesting - 1]?.name ?? null : null,
        children: self?.children ?? false,
        status: event.type === 'test:fail' ? 'FAIL' : [data.skip, data.todo].some(flag => flag !== undefined && flag !== false) ? 'SKIP' : 'PASS',
        durationMs: Math.round(data.details?.duration_ms ?? 0),
      }) + '\n';
    }
  }
};
