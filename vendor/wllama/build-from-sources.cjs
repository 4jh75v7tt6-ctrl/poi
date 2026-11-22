/*
 * Local, reproducible packaging of upstream wllama 2.3.7.
 * This file is POI build tooling, not an upstream distributed bundle.
 * Usage: node build-from-sources.cjs /path/to/wllama-2.3.7 [output.js]
 * Build dependencies: Node 24.22.3 and Playwright 1.62.1's bundled Babel.
 * No dependency is fetched or required by the resulting browser module.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const sourceRoot = path.resolve(process.argv[2] || '.');
const output = path.resolve(process.argv[3] || path.join(__dirname, 'index.js'));
const playwrightRoot = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright')
  : path.dirname(require.resolve('playwright/package.json'));
const playwrightVersion = JSON.parse(fs.readFileSync(path.join(playwrightRoot, 'package.json'), 'utf8')).version;
if (process.version !== 'v24.22.3' || playwrightVersion !== '1.62.1') {
  throw new Error('Reproducible build requires Node v24.22.3 and Playwright 1.62.1.');
}
const { babelParse, babelTransform, traverse } = require(path.join(playwrightRoot, 'lib/transform/babelBundle.js'));
const EXPECTED = {
  'src/index.ts': 'dfea2b6853335cf5a25826b655a4c718f3129d2e',
  'src/wllama.ts': '5a72baaf221ff1170e6a8f9b6e7d89941226ad7c',
  'src/cache-manager.ts': 'a2ecb7fab0569917d8a8513035d18ae1e1334eb7',
  'src/model-manager.ts': '507130ffd4f13982dbc889074ebaef12c0b2b601',
  'src/utils.ts': '7a78c95150c5e7048cb51e0e1dc66345ab682ddc',
  'src/worker.ts': 'ecf81fd844d8d2734f7d1eda6c5c1bd54dcedd9e',
  'src/glue/glue.ts': '7791f7b0c61d1def8341698d0554986eaa33841b',
  'src/glue/messages.ts': '29f376d2470551dc279d0e7b2d2eb182122cfd8c',
  'src/workers-code/generated.ts': 'd1685382c74d2e376376f596d0b7ba11ef115ce0',
};
const modules = {};
const dependencies = {};
const digests = {};
const gitHash = bytes => crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
function resolve(from, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error('External import: ' + specifier);
  const id = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)) + '.ts';
  if (!Object.hasOwn(EXPECTED, id)) throw new Error('Unpinned dependency: ' + id);
  return id;
}
for (const [id, expected] of Object.entries(EXPECTED)) {
  const bytes = fs.readFileSync(path.join(sourceRoot, id));
  if (gitHash(bytes) !== expected) throw new Error('Source Git hash differs: ' + id);
  const js = stripTypeScriptTypes(bytes.toString('utf8'), { mode: 'transform', sourceMap: false });
  const ast = babelParse(js, id.replace(/\.ts$/, '.js'), true);
  const deps = {};
  for (const statement of ast.program.body) {
    if (statement.source) deps[statement.source.value] = resolve(id, statement.source.value);
  }
  traverse(ast, {
    Import(path) { throw path.buildCodeFrameError('Dynamic imports are not supported by this build.'); },
  });
  const commonjs = babelTransform(js, id.replace(/\.ts$/, '.js'), false, [], []).code
    .replace(/^\/\/# sourceMappingURL=data:.*$/gm, '').trimEnd();
  const cjsAst = babelParse(commonjs, id.replace(/\.ts$/, '.cjs'), true);
  traverse(cjsAst, {
    CallExpression(p) {
      const n = p.node;
      if (n.callee.type !== 'Identifier' || n.callee.name !== 'require') return;
      if (n.arguments.length !== 1 || n.arguments[0].type !== 'StringLiteral' || !Object.hasOwn(deps, n.arguments[0].value)) {
        throw new Error('Unresolved require in ' + id);
      }
    },
  });
  modules[id] = { ast, commonjs };
  dependencies[id] = deps;
  digests[id] = { bytes: bytes.length, gitBlobSha1: expected, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
function namedExports(id, visiting = new Set()) {
  if (visiting.has(id)) throw new Error('Cyclic export-star graph');
  const next = new Set(visiting).add(id);
  const result = new Set();
  for (const statement of modules[id].ast.program.body) {
    if (statement.type === 'ExportAllDeclaration') {
      for (const name of namedExports(dependencies[id][statement.source.value], next)) result.add(name);
    } else if (statement.type === 'ExportNamedDeclaration') {
      if (statement.declaration) {
        const d = statement.declaration;
        if (d.id) result.add(d.id.name);
        else for (const v of d.declarations || []) {
          if (v.id.type !== 'Identifier') throw new Error('Unsupported exported binding');
          result.add(v.id.name);
        }
      }
      for (const specifier of statement.specifiers || []) result.add(specifier.exported.name || specifier.exported.value);
    }
  }
  return result;
}
const entryExports = [...namedExports('src/index.ts')].sort();
if (!entryExports.includes('Wllama') || !entryExports.includes('ModelManager')) throw new Error('Missing entry exports');
const header = '/* wllama 2.3.7 — locally packaged from commit 5e63e3b226a077b33dc7c608f1fe630f3d21f539.\n' +
  ' * Upstream source semantics preserved; TypeScript erased and modules wrapped locally.\n' +
  ' * This is not the upstream npm byte-for-byte bundle. See PROVENANCE.json and LICENSE-*.txt.\n' +
  ' */\n';
const factories = Object.entries(modules).map(([id, m]) => JSON.stringify(id) + ': function(module, exports, require) {\n' + m.commonjs + '\n}').join(',\n');
const loader = '\nconst __w237Cache = Object.create(null);\n' +
  'function __w237Require(id) {\n' +
  '  if (__w237Cache[id]) return __w237Cache[id].exports;\n' +
  '  const factory = __w237Factories[id];\n' +
  '  if (!factory) throw new Error("Unknown bundled module: " + id);\n' +
  '  const module = { exports: {} };\n' +
  '  __w237Cache[id] = module;\n' +
  '  factory(module, module.exports, specifier => {\n' +
  '    const target = __w237Dependencies[id][specifier];\n' +
  '    if (!target) throw new Error("Unknown bundled dependency: " + specifier);\n' +
  '    return __w237Require(target);\n' +
  '  });\n' +
  '  return module.exports;\n' +
  '}\nconst __w237Entry = __w237Require("src/index.ts");\n';
const bundle = header + 'const __w237Factories = {\n' + factories + '\n};\n' +
  'const __w237Dependencies = ' + JSON.stringify(dependencies, null, 2) + ';\n' + loader +
  entryExports.map(name => 'const __w237Export_' + name + ' = __w237Entry.' + name + ';\nexport { __w237Export_' + name + ' as ' + name + ' };').join('\n') + '\n';
const bundleAst = babelParse(bundle, 'index.js', true);
if (bundleAst.program.body.some(s => s.type === 'ImportDeclaration' || (s.type.startsWith('Export') && s.source))) {
  throw new Error('Result has an external module import');
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, bundle);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(bundle), sha256: crypto.createHash('sha256').update(bundle).digest('hex'), exports: entryExports, modules: digests }, null, 2));
