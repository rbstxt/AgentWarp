import {defineConfig} from 'vite';
import {fileURLToPath, URL} from 'node:url';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src', import.meta.url))}},define:{'process.env.NODE_ENV':JSON.stringify('production')},plugins:[tailwindcss()], build:{lib:{entry:'src/mount.tsx',name:'AgentWarp',formats:['iife'],fileName:()=> 'agentwarp-client.js'},cssCodeSplit:false,rollupOptions:{output:{inlineDynamicImports:true}}}});
