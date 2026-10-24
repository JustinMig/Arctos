import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
await rm('dist',{recursive:true,force:true}); await mkdir('dist/assets',{recursive:true});
// Retain the auxiliary SOA/signature and migration pages and unbundled compatibility modules.
for (const entry of await readdir('.',{withFileTypes:true})) {
  if (entry.isFile() && /\.(html|css|js|webmanifest|png)$/.test(entry.name)) await cp(entry.name,`dist/${entry.name}`);
}
await cp('assets','dist/assets',{recursive:true});
// Unbundled auxiliary pages need the same locally served SDK.
await build({stdin:{contents:"export { createClient } from '@supabase/supabase-js';",resolveDir:process.cwd(),sourcefile:'supabase-vendor.js'},bundle:true,format:'esm',minify:true,target:'es2022',outfile:'dist/vendor/supabase.js'});
const sourceClient = await readFile('supabase-client.js','utf8');
await writeFile('dist/supabase-client.js',sourceClient.replace("'@supabase/supabase-js'","'/vendor/supabase.js'"));
await build({entryPoints:['auth-base.css','workspace-styles.css'],outdir:'dist',bundle:true,minify:true});
const cssAssets = {};
for (const name of ['auth-base','workspace-styles','client-record-page-colors']) {
  const contents = await readFile(`dist/${name}.css`);
  const hash = createHash('sha256').update(contents).digest('hex').slice(0,12);
  cssAssets[name] = `/assets/${name}-${hash}.css`;
  await writeFile('dist'+cssAssets[name], contents);
}
const result=await build({entryPoints:{app:'app.js'},outdir:'dist/assets',bundle:true,splitting:true,format:'esm',target:['chrome109','safari16','firefox115'],minify:true,entryNames:'[name]-[hash]',chunkNames:'[name]-[hash]',metafile:true,define:{__ARCTOS_WORKSPACE_CSS__:JSON.stringify(cssAssets['workspace-styles'])},plugins:[{name:'canonical-local-modules',setup(b){b.onResolve({filter:/^\.\.?\/.*\?v=/},args=>({path:path.resolve(args.resolveDir,args.path.split('?')[0])}));}}]});
const entry=Object.entries(result.metafile.outputs).find(([,value])=>value.entryPoint==='app.js')?.[0];
if(!entry)throw new Error('Missing public app entry');
let html=await readFile('index.html','utf8');
html=html.replace(/src=["']\/app\.js(?:\?[^"']*)?["']/, `src="/${entry.replace(/^dist\//,'')}"`);
html=html.replace('href="/auth-base.css"', `href="${cssAssets['auth-base']}"`);
html=html.replace(/href="\/client-record-page-colors\.css(?:\?[^"']*)?"/, `href="${cssAssets['client-record-page-colors']}"`);
if (!/\/assets\/app-[A-Za-z0-9_-]+\.js/.test(html)) throw new Error('Production HTML did not receive the bundled app entry.');
await writeFile('dist/index.html',html);
await writeFile('dist/build-info.json',JSON.stringify({commit:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA||'local',builtAt:new Date().toISOString(),entry,cssAssets}));
await writeFile('build-metafile.json',JSON.stringify(result.metafile,null,2));
