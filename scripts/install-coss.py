import json,pathlib,subprocess
seen=set()
def add(name):
 name=name.replace('@coss/','')
 if name in seen:return
 seen.add(name)
 data=json.loads(subprocess.check_output(['curl','-fLs','https://coss.com/ui/r/'+name+'.json']))
 for dep in data.get('registryDependencies',[]):
  if dep.startswith('@coss/'):add(dep)
 for f in data.get('files',[]):
  if not f['path'].endswith(('.ts','.tsx')):continue
  path=pathlib.Path('src/components/coss')/pathlib.Path(f['path']).name
  path.parent.mkdir(parents=True,exist_ok=True)
  content=f['content'].replace('@/registry/default/lib/utils','@/lib/utils').replace('@/registry/default/ui/','@/components/coss/').replace('@/registry/default/hooks/','@/hooks/')
  path.write_text(content)
for n in ['button','dialog','input','textarea','select','tabs','badge','toggle-group','label']:add(n)
print(sorted(seen))
