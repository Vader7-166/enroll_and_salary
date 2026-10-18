"""Validate the frozen R1 design scope; this does not execute product UAT."""

from collections import Counter
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path('docs/config/hrtp-release-r1.json')
FR_PATTERN = re.compile(r'FR-(?:\d+\.\d+\.\d+|X\.\d+)')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(root, relative):
    return (root / relative).read_text(encoding='utf-8')


def parse_requirements(markdown):
    result = {}
    for line in markdown.splitlines():
        if not line.startswith('|'):
            continue
        cells = [cell.strip() for cell in line.split('|')[1:-1]]
        identifiers = [cell for cell in cells if FR_PATTERN.fullmatch(cell)]
        priorities = [cell for cell in cells if cell in {'M', 'S', 'C'}]
        if identifiers and priorities:
            require(len(identifiers) == len(priorities) == 1, 'Ambiguous FR row')
            identifier = identifiers[0]
            require(identifier not in result, f'Duplicate FR: {identifier}')
            result[identifier] = priorities[0]
    return result


def validate(root=ROOT, manifest=None):
    root = Path(root)
    base = root / MANIFEST.parent
    if manifest is None:
        manifest = json.loads(read(root, MANIFEST))
    requirements_text = read(root, 'docs/07-yeu-cau-chuc-nang.md')
    specified = parse_requirements(requirements_text)
    entries = manifest['requirements']
    frozen = {entry['id']: entry for entry in entries}
    require(len(frozen) == len(entries), 'Duplicate FR in manifest')
    require(set(frozen) == set(specified), 'FR set differs between 07 and manifest')
    require(len(frozen) == 158, 'R1 baseline must contain exactly 158 FR')
    groups = set(manifest['acceptance_groups'])
    require(groups == {f'R1-AC-{i:02}' for i in range(1, 13)}, 'Acceptance groups differ')

    for identifier, priority in specified.items():
        entry = frozen[identifier]
        require(entry['priority'] == priority, f'Priority differs: {identifier}')
        parts = identifier.removeprefix('FR-').split('.')
        module = parts[0]
        bfd = '.'.join(parts[:2]) if module != 'X' and parts[1] != '0' else None
        require(entry['bfd'] == bfd, f'Incorrect BFD mapping: {identifier}')
        if priority == 'M':
            expected_mode = 'DISABLED_GUARD' if identifier == 'FR-5.5.1' else 'ENABLED'
            number = 11 if module == 'X' else int(module)
            require(entry['release'] == 'R1' and entry['mode'] == expected_mode,
                    f'Incorrect release/mode: {identifier}')
            require(entry['acceptance_group'] == f'R1-AC-{number:02}',
                    f'Incorrect acceptance mapping: {identifier}')
            require(entry['verification_status'] in {'NOT_EXECUTED', 'PASS', 'FAIL', 'BLOCKED'},
                    f'Invalid verification status: {identifier}')
        else:
            require(entry['release'] == 'POST_R1' and entry['mode'] == 'DEFERRED'
                    and entry['acceptance_group'] is None
                    and entry['verification_status'] == 'NOT_IN_R1',
                    f'Deferred FR included in R1: {identifier}')

    deferred = {identifier for identifier, priority in specified.items() if priority != 'M'}
    require(deferred == {'FR-1.2.4', 'FR-1.2.5', 'FR-2.1.6', 'FR-2.2.5',
                         'FR-3.4.3', 'FR-7.1.5'}, 'Deferred baseline changed')
    priorities = Counter(specified.values())
    require(priorities == {'M': 152, 'S': 5, 'C': 1}, 'Priority totals differ')

    # Check the human-readable per-module summary, not only the manifest totals.
    summary = requirements_text.split('## 13.', 1)[1].split('## 14.', 1)[0]
    checked_modules = set()
    for line in summary.splitlines():
        cells = [cell.strip() for cell in line.split('|')[1:-1]]
        if len(cells) != 6:
            continue
        match = re.match(r'^(\d+)\.', cells[0])
        module = match[1] if match else ('X' if cells[0] == 'Xuyên suốt' else None)
        if module is None:
            continue
        totals = Counter(priority for identifier, priority in specified.items()
                         if identifier.removeprefix('FR-').split('.')[0] == module)
        require(tuple(map(int, cells[2:5])) == tuple(totals[level] for level in 'MSC'),
                f'Priority summary differs for module {module}')
        checked_modules.add(module)
    require(checked_modules == set(map(str, range(1, 11))) | {'X'}, 'Summary incomplete')

    functions = manifest['functions']
    function_map = {item['id']: item for item in functions}
    expected_functions = {f'{module}.{number}'
                          for module, count in enumerate([6, 5, 4, 5, 5, 5, 6, 5, 4, 4], 1)
                          for number in range(1, count + 1)}
    require(len(functions) == len(function_map) == 49
            and set(function_map) == expected_functions, 'BFD function set differs')
    for identifier, function in function_map.items():
        mode = 'DISABLED_GUARD' if identifier == '5.5' else 'ENABLED'
        require(function['mode'] == mode and function['name'], f'BFD mode differs: {identifier}')
        related = [entry for entry in entries if entry['bfd'] == identifier
                   and entry['release'] == 'R1']
        require(related and any(entry['mode'] == mode for entry in related),
                f'No R1 requirement covering BFD {identifier}')

    require(manifest['counts'] == {
        'total_requirements': 158, 'r1_required': 152, 'r1_enabled_requirements': 151,
        'r1_disabled_guard_requirements': 1, 'post_r1_requirements': 6,
        'bfd_functions': 49, 'enabled_bfd_functions': 48, 'disabled_guard_bfd_functions': 1,
        'uat_rows': 29, 'nfr_count': 60}, 'Manifest totals differ')
    policy = json.loads((base / manifest['simulation_policy']).read_text(encoding='utf-8'))
    require(manifest['context'] == 'ACADEMIC_SIMULATION' and policy['status'] == 'SIMULATION'
            and policy['production_ready'] is False, 'Simulation context changed')
    require(policy['release_baseline_id'] == manifest['baseline_id']
            and policy['release_manifest'] == MANIFEST.name, 'Simulation baseline differs')
    require(manifest['comp_time_enabled'] is False
            and policy['defaults']['comp_time_enabled'] is False
            and policy['defaults']['comp_time_reduces_ot_payment'] is False,
            'DEC-01 violated')
    require(set(manifest['pay_modes']) == set(policy['payroll']['supported_pay_modes'])
            and len(manifest['pay_modes']) == 6, 'DEC-02 pay modes differ')
    require(manifest['email_in_r1'] is False, 'Email is not in R1')
    require(manifest['compliance_policy']['CP-08'] == 'WARNING'
            and manifest['compliance_policy']['blocking_checks_cannot_be_downgraded'],
            'Compliance severity changed')
    require(set(manifest['actors']) == {'TT', 'QD', 'KT', 'AD'}, 'Actor scope changed')
    require(set(manifest['sites']) == {item['code'] for item in policy['sites']},
            'Site scope differs from simulation')

    data_model = read(root, 'docs/09-mo-hinh-du-lieu.md')
    required_entities = {name for names in manifest['required_entities'].values() for name in names}
    require(not required_entities.intersection(manifest['inactive_entities']),
            'Inactive entity incorrectly required')
    for entity in required_entities | set(manifest['inactive_entities']):
        require(re.search(r'\b' + re.escape(entity) + r'\b', data_model),
                f'Entity missing from data specification: {entity}')
    acceptance = read(root, 'docs/19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md')
    matrix_groups = re.findall(r'^\| (R1-AC-\d{2}) \|', acceptance, re.M)
    require(len(matrix_groups) == len(set(matrix_groups)) == 12
            and set(matrix_groups) == groups, 'Acceptance matrix differs')
    story = read(root, 'docs/14-user-story-va-tieu-chi-nghiem-thu.md')
    require(len(re.findall(r'^\| \*\*UAT-', story, re.M)) == 29, 'UAT row count changed')
    ac = re.findall(r'^\| \*\*AC (\d+\.\d+)\*\*', story, re.M)
    require(len(ac) == len(set(ac)), 'Duplicate acceptance criteria')
    nfr = read(root, 'docs/15-yeu-cau-phi-chuc-nang.md')
    nfr_ids = re.findall(r'^\| \*\*(NFR-\d+)\*\*', nfr, re.M)
    require(len(nfr_ids) == len(set(nfr_ids)) == 60, 'NFR count changed')

    for key in ('specification', 'requirements_source', 'simulation_policy'):
        require((base / manifest[key]).is_file(), f'Missing manifest reference: {key}')
    for target in manifest['diagrams']:
        require((base / target).is_file(), f'Missing release diagram: {target}')
    scope_diagram = read(root, 'diagrams/release/R1-scope.mmd').strip()
    require(scope_diagram in acceptance, 'Inline R1 diagram differs from source')
    bfd_diagram = read(root, 'diagrams/release/R1-bfd.mmd')
    diagram_ids = re.findall(r'^\s+F_\d+_\d+\["(\d+\.\d+) ', bfd_diagram, re.M)
    require(len(diagram_ids) == 49 and set(diagram_ids) == expected_functions,
            'R1 BFD diagram does not match manifest')
    if manifest['implementation_status'] == 'NOT_IMPLEMENTED':
        require(all(entry['verification_status'] in {'NOT_EXECUTED', 'NOT_IN_R1'}
                    for entry in entries), 'Unimplemented baseline cannot claim test results')

    for path in (root / 'docs').glob('*.md'):
        text = path.read_text(encoding='utf-8')
        require(text.count('```') % 2 == 0, f'Unbalanced code fence: {path.name}')
        for target in re.findall(r'\]\(([^)]+)\)', text):
            if '://' in target or target.startswith('#'):
                continue
            local = target.split('#', 1)[0]
            if local:
                require((path.parent / local).exists(), f'Broken local link: {path.name}: {local}')

    return '158 FR matched; 152 R1 (151 enabled + 1 disabled guard); 6 deferred; 49 BFD; 12 acceptance groups; 29 UAT; 60 NFR.'


if __name__ == '__main__':
    try:
        print('PASS: ' + validate())
        print('Scope consistency only; product implementation and UAT remain NOT_EXECUTED.')
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        print('FAIL: ' + str(error), file=sys.stderr)
        sys.exit(1)
