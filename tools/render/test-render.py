#!/usr/bin/env python3
"""Exercise pen and pixel-color sensing against an actual rendered stage."""
import hashlib, json, pathlib, subprocess, tempfile, zipfile
root = pathlib.Path(__file__).resolve().parents[2]
with zipfile.ZipFile(root / 'tools/vmrun/test-fixtures/greenflag.sb3') as z:
    project = json.loads(z.read('project.json'))
    assets = {n: z.read(n) for n in z.namelist() if n != 'project.json'}
stage, sprite = project['targets']
svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#ff0000"/></svg>'
id = hashlib.md5(svg).hexdigest(); assets[id+'.svg'] = svg
stage['costumes'][0].update(assetId=id, md5ext=id+'.svg', rotationCenterX=240, rotationCenterY=180)
empty = b'<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" viewBox="0 0 0 0"></svg>'
empty_id = hashlib.md5(empty).hexdigest(); assets[empty_id+'.svg'] = empty
stage['costumes'].append(dict(stage['costumes'][0], name='empty', assetId=empty_id, md5ext=empty_id+'.svg'))
stage['blocks'] = {}; stage['variables'] = {'color':['color',0]}
sprite['blocks'] = {
 'h': {'opcode':'event_whenflagclicked','next':'p','parent':None,'inputs':{},'fields':{},'shadow':False,'topLevel':True,'x':10,'y':10},
 'p': {'opcode':'pen_penDown','next':'m','parent':'h','inputs':{},'fields':{},'shadow':False,'topLevel':False},
 'm': {'opcode':'motion_movesteps','next':'v','parent':'p','inputs':{'STEPS':[1,[4,'80']]},'fields':{},'shadow':False,'topLevel':False},
 'v': {'opcode':'data_setvariableto','next':None,'parent':'m','inputs':{'VALUE':[2,'c']},'fields':{'VARIABLE':['color','color']},'shadow':False,'topLevel':False},
 'c': {'opcode':'sensing_touchingcolor','next':None,'parent':'v','inputs':{'COLOR':[1,[9,'#ff0000']]},'fields':{},'shadow':False,'topLevel':False}}
project['extensions']=['pen']
with tempfile.TemporaryDirectory() as tmp:
    sb3=pathlib.Path(tmp)/'test.sb3'; out=pathlib.Path(tmp)/'out'
    with zipfile.ZipFile(sb3,'w') as z:
        z.writestr('project.json',json.dumps(project))
        for name, data in assets.items(): z.writestr(name,data)
    run=subprocess.run(['node',str(root/'tools/render/cli.mjs'),'shot',str(sb3),'--frames','5','--out',str(out)],cwd=root,text=True,capture_output=True,check=True)
    state=json.loads(run.stdout)
    assert str(state['targets'][0]['variables']['color']).lower() == 'true', state
    js="const {PNG}=require('pngjs');const fs=require('fs');const p=PNG.sync.read(fs.readFileSync(process.argv[1]));let n=0;for(let x=241;x<315;x++){let i=(180*480+x)*4;if(p.data[i]<240||p.data[i+1]>20||p.data[i+2]>20)n++}if(n<20)throw Error('pen line missing: '+n);console.log('color sensing and pen passed, line pixels:',n)"
    subprocess.run(['node','-e',js,str(out/'frame-000004.png')],cwd=root/'tools/render',check=True)

    assert 'loaded ' in run.stderr and 'frame 5 of 5' in run.stderr, run.stderr
    timeout = subprocess.run(['node',str(root/'tools/render/cli.mjs'),'shot',str(sb3),'--frames','5','--timeout','0.01','--out',str(out)],cwd=root,text=True,capture_output=True,timeout=10)
    assert timeout.returncode != 0 and 'timed out' in timeout.stderr, timeout.stderr
    print('empty SVG and timeout passed')
