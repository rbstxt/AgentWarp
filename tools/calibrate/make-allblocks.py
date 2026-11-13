import json, zipfile
src='tools/vmrun/test-fixtures/greenflag.sb3'; out='eval/calibration/holdout/allblocks.sb3'
with zipfile.ZipFile(src) as z:
 files={n:z.read(n) for n in z.namelist()}; p=json.loads(files['project.json'])
t=next(t for t in p['targets'] if not t['isStage']); t['blocks']={}; t['comments']={}; t['variables']['jvar']=['日本語の変数',0]; t['lists']['jlist']=['日本語リスト',[]]
specs=json.load(open('packages/core/catalog/blocks.json'))['blocks']; blocks=t['blocks']
for i,(op,s) in enumerate(specs.items()):
 if s.get('hidden') or s.get('isShadowOnly') or s['shape'] in ('prototype','argument') or op in ('procedures_definition','procedures_call'): continue
 fields={}
 for f in s['fields']:
  val=(f.get('options') or [[None,'']])[0][1]
  if f['kind']=='variable': fields[f['name']]=['日本語の変数','jvar']
  elif f['kind']=='list': fields[f['name']]=['日本語リスト','jlist']
  else: fields[f['name']]=[val,None]
 inputs={}
 for inp in s['inputs']:
  k=inp['kind']; name=inp['name']; val=inp.get('default','10')
  if k in ('stack','boolean'): continue
  types={'number':4,'positive_number':5,'whole_number':6,'integer':7,'angle':8,'color':9,'text':10,'broadcast':11}
  if k == 'color': inputs[name]=[1,[9,'#9966ff']]
  elif k in types: inputs[name]=[1,[types[k],str(val)]]
  elif inp.get('shadowOpcode'):
   sid=f's{i}_{name}'; sf=(specs.get(inp['shadowOpcode'],{}).get('fields') or [{}])[0]; field=inp.get('shadowField') or sf.get('name','OPTION'); val=inp.get('default',(sf.get('options') or [[None,'']])[0][1]); fields2={field:[str(val),None]}; blocks[sid]={'opcode':inp['shadowOpcode'],'parent':f'b{i}','next':None,'inputs':{},'fields':fields2,'shadow':True,'topLevel':False}; inputs[name]=[1,sid]
 blocks[f'b{i}']={'opcode':op,'next':None,'parent':None,'inputs':inputs,'fields':fields,'shadow':False,'topLevel':True,'x':(i%8)*500,'y':(i//8)*220}
mutation={'tagName':'mutation','children':[],'proccode':'日本語 %s and %b','argumentids':'["s","b"]','argumentnames':'["文章","真偽"]','argumentdefaults':'["","false"]','warp':'false'}
blocks['definition']={'opcode':'procedures_definition','next':None,'parent':None,'inputs':{'custom_block':[1,'proto']},'fields':{},'shadow':False,'topLevel':True,'x':0,'y':5000}
blocks['proto']={'opcode':'procedures_prototype','next':None,'parent':'definition','inputs':{},'fields':{},'shadow':True,'topLevel':False,'mutation':mutation}
blocks['call']={'opcode':'procedures_call','next':None,'parent':None,'inputs':{'s':[1,[10,'長い日本語の文章 hello world']]},'fields':{},'shadow':False,'topLevel':True,'x':500,'y':5000,'mutation':mutation}
# Additional mixed stack with a nested C-block and three nested reporters.
blocks['mix']={'opcode':'event_whenflagclicked','parent':None,'next':'outer','inputs':{},'fields':{},'shadow':False,'topLevel':True,'x':1000,'y':5000}
blocks['outer']={'opcode':'control_repeat','parent':'mix','next':'say','inputs':{'TIMES':[1,[6,'3']],'SUBSTACK':[2,'inner']},'fields':{},'shadow':False,'topLevel':False}
blocks['inner']={'opcode':'control_if','parent':'outer','next':None,'inputs':{},'fields':{},'shadow':False,'topLevel':False}
blocks['say']={'opcode':'looks_say','parent':'outer','next':None,'inputs':{'MESSAGE':[3,'join',[10,'']]},'fields':{},'shadow':False,'topLevel':False}
blocks['join']={'opcode':'operator_join','parent':'say','next':None,'inputs':{'STRING1':[1,[10,'日本語の長い文章と a long sentence with wide characters WWW']],'STRING2':[3,'length',[10,'']]},'fields':{},'shadow':False,'topLevel':False}
blocks['length']={'opcode':'operator_length','parent':'join','next':None,'inputs':{'STRING':[3,'join2',[10,'']]},'fields':{},'shadow':False,'topLevel':False}
blocks['join2']={'opcode':'operator_join','parent':'length','next':None,'inputs':{'STRING1':[1,[10,'深い']],'STRING2':[1,[10,'nesting']]},'fields':{},'shadow':False,'topLevel':False}
p['extensions']=['pen','music','text2speech','translate','videoSensing','makeymakey']; files['project.json']=json.dumps(p,ensure_ascii=False).encode()
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for name,data in files.items(): z.writestr(name,data)
print('created',out,'top blocks',sum(x.get('topLevel',False) for x in blocks.values()))
