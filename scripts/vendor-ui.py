import json,re,pathlib,sys
root=pathlib.Path(sys.argv[1]) / 'apps/v4/public/r'
pkg=json.load(open('package.json'))
seen=set()
def add(name):
 name=name.replace('@extend/','')
 if name in seen:return
 seen.add(name)
 source=root/(name+'.json')
 if not source.exists():
  print('MISSING',name);return
 d=json.load(open(source))
 for dep in d.get('dependencies',[]):
  i=dep.rfind('@'); k,v=(dep[:i],dep[i+1:]) if i>0 else (dep,'latest')
  pkg['dependencies'][k]=v
 for dep in d.get('registryDependencies',[]):add(dep)
 for f in d.get('files',[]):
  t=f.get('target','')
  for a,b in [('@components/','src/components/'),('@ui/','src/components/ui/'),('@lib/','src/lib/'),('@hooks/','src/hooks/')]:t=t.replace(a,b)
  if not t or not t.startswith('src/'):continue
  s=f['content']
  s=re.sub(r'import \{ IconPlaceholder \} from [^\n]+\n','',s)
  icons=set()
  def icon(m):
   attrs=m.group(1)
   match=re.search(r'lucide="([^"]+)"',attrs)
   if not match:raise Exception(attrs)
   n=match.group(1);icons.add(n)
   attrs=re.sub(r'\s*(?:lucide|tabler|hugeicons|phosphor|remixicon)="[^"]+"','',attrs)
   return '<'+n+attrs+'/>'
  s=re.sub(r'<IconPlaceholder\b(.*?)/>',icon,s,flags=re.S)
  if icons:s='import { '+', '.join(sorted(icons))+' } from "lucide-react"\n'+s
  path=pathlib.Path(t);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(s)
for n in ['file-system','badge','textarea','label','switch']:add(n)
pathlib.Path('package.json').write_text(json.dumps(pkg,indent=2)+'\n')
print('Installed registry sources:',', '.join(sorted(seen)))
