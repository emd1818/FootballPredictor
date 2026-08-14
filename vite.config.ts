import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({plugins:[react()],root:path.resolve(process.cwd(),'client'),resolve:{alias:{'@':path.resolve(process.cwd(),'client/src'),'@shared':path.resolve(process.cwd(),'shared')}},build:{outDir:path.resolve(process.cwd(),'dist'),emptyOutDir:true}});
