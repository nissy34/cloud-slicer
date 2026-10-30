# gdb script: runs desktop's command line with the one-line fix of our
# engine/patches/0010 (OrcaSlicer #15564) applied while it runs. Fill::
# connect_base_support keeps three limits in function-static variables, so
# they come from whichever support fill ran first; zeroing their "already set"
# guards on every call makes desktop work them out again each time, as the
# fixed code does. check.mjs uses it for the support cases:
#
#   gdb -q -batch -x desktop-fix.py --args <desktop binary> <arguments>
import gdb
import subprocess

binary = gdb.current_progspace().filename
symbols = subprocess.run(['nm', binary], capture_output=True, text=True, check=True).stdout.splitlines()
def address(line): return int(line.split()[0], 16)
main = next(address(l) for l in symbols if l.endswith(' T main'))
calls = [address(l) for l in symbols if ' T _ZN6Slic3r4Fill20connect_base_support' in l]
guards = [address(l) for l in symbols if '_ZGVZN6Slic3r4Fill20connect_base_support' in l]
if not calls or len(guards) != 3:
    raise gdb.GdbError(f'desktop-fix.py: expected connect_base_support and its 3 static limits, found {len(calls)} and {len(guards)}')

gdb.execute('set pagination off')
gdb.execute('set confirm off')
start = gdb.Breakpoint('main', internal=True)
gdb.execute('run')
start.delete()
# A position-independent binary: addresses from nm are relative to main's.
base = int(gdb.parse_and_eval('(long)&main')) - main
inferior = gdb.selected_inferior()

class Recompute(gdb.Breakpoint):
    def stop(self):
        for g in guards:
            inferior.write_memory(base + g, b'\0' * 8)
        return False

for c in calls:
    Recompute(f'*{base + c:#x}', internal=True)
gdb.execute('continue')
exit_code = gdb.parse_and_eval('$_exitcode')
gdb.execute(f'quit {int(exit_code) if exit_code.type.code != gdb.TYPE_CODE_VOID else 1}')
