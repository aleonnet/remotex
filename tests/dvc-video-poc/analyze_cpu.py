"""Cut cpu-procs.ps1's samples by the phases host_cpu_acked_against_withheld recorded, and
print each busy process's CPU per phase: which host process does the graphics encoding, and
whether it stops while acknowledgements are withheld."""
import collections
import pathlib
import re

OUT = pathlib.Path(__file__).resolve().parents[2] / 'tmp' / 'dvc-video-poc'
samples = collections.defaultdict(list)  # (pid,name,svc) -> [(t,cpu)]
cores = None
for line in open(OUT / 'cpu-procs.log'):
    parts = line.split()
    if parts and parts[0] == 'cores':
        cores = int(parts[1]); continue
    if len(parts) < 5: continue
    t, pid, name, cpu, svc = float(parts[0]), parts[1], parts[2], float(parts[3]), parts[4]
    samples[(pid, name, svc)].append((t, cpu))
bounds = []
for line in open(OUT / 'cpu-phases.txt'):
    m = re.match(r'(\S+) (\S+) (\S+)', line)
    if m: bounds.append((m[1], float(m[2]), float(m[3])))

def usage(series, a, b):
    # CPU seconds between the last sample at or before a and the first at or after b, scaled to [a, b].
    before = [s for s in series if s[0] <= a]
    after = [s for s in series if s[0] >= b]
    if not before or not after: return None
    (t0, c0), (t1, c1) = before[-1], after[0]
    return (c1 - c0) / (t1 - t0)  # cores busy on average

table = {}
for key, series in samples.items():
    row = [usage(series, a, b) for _, a, b in bounds]
    if any(r is None for r in row): continue
    table[key] = row
names = [n for n, _, _ in bounds]
print(f"cores {cores}; values are % of one core, averaged over each 55 s phase")
print(f"{'process':44}" + ''.join(f"{n:>12}" for n in names))
for key, row in sorted(table.items(), key=lambda kv: -max(kv[1]))[:18]:
    pid, name, svc = key
    label = f"{name}[{pid}]" + (f" {svc}" if svc != '-' else '')
    print(f"{label[:44]:44}" + ''.join(f"{100*v:12.1f}" for v in row))
tot = [sum(r[i] for r in table.values()) for i in range(len(names))]
print(f"{'TOTAL (all processes)':44}" + ''.join(f"{100*v:12.1f}" for v in tot))
