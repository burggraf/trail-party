import assert from 'node:assert/strict';
import test from 'node:test';
import { FetchError, initClient } from 'trailbase';
import { randomBytes } from 'node:crypto';
import { startStack } from './stack.ts';

const SAFE_PROJECTIONS: Record<string, string[]> = {
  profiles_public: ['avatar_mime', 'avatar_revision', 'display_name', 'id', 'updated_at', 'version'],
  games_public: ['duration_minutes', 'id', 'lifecycle', 'location', 'roster_locked_at', 'roster_version', 'starts_at', 'title', 'updated_at', 'version'],
  games_host: ['auto_reveal', 'duration_minutes', 'host_id', 'id', 'join_code', 'lifecycle', 'location', 'roster_locked_at', 'roster_version', 'starts_at', 'timers', 'title', 'updated_at', 'version'],
  game_teams: ['game_id', 'id', 'name', 'updated_at', 'version'],
  game_players: ['game_id', 'id', 'left_at', 'team_id', 'updated_at', 'user_id', 'version'],
  game_state_public: ['all_answered_at', 'assignment_id', 'choices', 'created_at', 'deadline_at', 'id', 'paused_remaining_seconds', 'phase', 'question_ordinal', 'question_text', 'revealed', 'round_id', 'round_ordinal', 'round_title', 'updated_at', 'version'],
  displays_public: ['claim_version', 'game_id', 'host_id', 'id', 'settings', 'updated_at', 'version'],
  online: ['game_id', 'id', 'last_seen_at', 'version', 'visibility'],
};
const SCHEMA_MODES = ['insert', 'select', 'update'];
const PRIVATE_APIS = [
  'profiles', 'questions', 'rounds', 'games', 'game_questions', 'assignment_private',
  'game_answers', 'answer_grades_private', 'used_question_history', 'displays', 'audit_events', 'pairing_limits',
];
const DENIED_STATUSES = [400, 401, 403, 404, 405];

type Failure = string;
type Schema = { type?: string; properties?: Record<string, unknown> };
type SnapshotObject = { type: string; name: string; sql?: string; columns?: unknown[]; foreign_keys?: unknown[]; indexes?: unknown[] };
type ConstraintProbe = {
  foreign_keys?: number;
  uuid_semantics?: { malformed_false?: boolean; sixteen_byte_true?: boolean };
  native_linkage?: { existing_profiles?: number; malformed_rejected?: boolean; absent_native_rejected?: boolean; duplicate_existing_rejected?: boolean };
  questions?: { positive_integer_ids?: boolean; source_unique_rejected?: boolean; zero_id_rejected?: boolean; metadata_null_empty_fidelity?: boolean };
  game_setup?: { cross_game_composite_fk_rejected?: boolean; duplicate_membership_rejected?: boolean; duplicate_team_name_rejected?: boolean; duplicate_round_order_rejected?: boolean; partial_round_start_state_rejected?: boolean; partial_round_end_state_rejected?: boolean; partial_round_play_state_rejected?: boolean; host_immutability_rejected?: boolean };
  pairing_limits?: { valid_actor_bucket_accepted?: boolean; invalid_actor_bucket_rejected?: boolean; negative_blocked_until_rejected?: boolean; errors?: string[] };
  audit_constraints?: { valid_actor_and_action_accepted?: boolean; malformed_actor_rejected?: boolean; unknown_action_rejected?: boolean };
  rollback?: { second_write_failed?: boolean; first_write_absent_after_rollback?: boolean };
  guards?: Record<string, unknown>;
  foreign_key_check?: boolean;
};
type MismatchProbe = {
  rejected?: boolean;
  rolled_back?: boolean;
  match_trigger?: boolean;
  append_only_trigger?: boolean;
  immutable_trigger?: boolean;
};
type HostProbe = {
  foreign_keys?: number;
  deferred_sql_survives?: boolean;
  incomplete?: { stage?: string; committed?: boolean };
  complete?: { stage?: string; committed?: boolean };
  mismatch?: {
    history_insert?: MismatchProbe;
    history_update?: MismatchProbe;
    assignment_insert?: MismatchProbe;
    assignment_update?: MismatchProbe;
    no_partial_mismatched_rows?: boolean;
    valid_partner_intact?: boolean;
  };
};
type DeferredProbe = { foreign_keys?: number; incomplete?: { stage?: string; committed?: boolean; error?: string }; complete?: { stage?: string; committed?: boolean; error?: string } };

function describeError(error: unknown): string {
  if (error instanceof FetchError) return `HTTP ${error.status}`;
  return error instanceof Error ? error.message : String(error);
}

function isDenied(error: unknown): boolean {
  return error instanceof FetchError && DENIED_STATUSES.includes(error.status);
}

function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: no result within 2s`)), 2000);
    }),
  ]).finally(() => clearTimeout(timer));
}

function requiredSchema(stack: Awaited<ReturnType<typeof startStack>>, api: string, mode: string, check: string): Schema {
  try {
    return stack.schema(api, mode) as Schema;
  } catch (error) {
    assert.fail(`${check}: required ${api} ${mode} schema is missing; P01 exposes only bootstrap_ready (${describeError(error)})`);
  }
}

function assertSchemaFields(schema: Schema, fields: string[], check: string) {
  assert.equal(schema.type, 'object', `${check}: generated schema must be an object`);
  assert.ok(schema.properties && typeof schema.properties === 'object', `${check}: generated schema properties are missing`);
  assert.deepEqual(Object.keys(schema.properties).sort(), [...fields].sort(),
    `${check}: generated schema must expose exactly the safe projection`);
}

function assertSafeRecord(record: unknown, fields: string[], check: string) {
  assert.ok(record && typeof record === 'object' && !Array.isArray(record), `${check}: response row is not an object`);
  assert.deepEqual(Object.keys(record as object).sort(), [...fields].sort(),
    `${check}: response row exposes a private or unexpected field`);
}

function hexId(id: string): string {
  return Buffer.from(id, 'base64url').toString('hex');
}

function encodedId(hex: string): string {
  return `${Buffer.from(hex, 'hex').toString('base64url')}==`;
}

function v7Hex(): string {
  const value = randomBytes(16);
  const timestamp = BigInt(Date.now());
  value[0] = Number(timestamp >> 40n) & 0xff;
  value[1] = Number(timestamp >> 32n) & 0xff;
  value[2] = Number(timestamp >> 24n) & 0xff;
  value[3] = Number(timestamp >> 16n) & 0xff;
  value[4] = Number(timestamp >> 8n) & 0xff;
  value[5] = Number(timestamp) & 0xff;
  value[6] = (value[6] & 0x0f) | 0x70;
  value[8] = (value[8] & 0x3f) | 0x80;
  return value.toString('hex');
}

function snapshotObjects(snapshot: unknown): SnapshotObject[] {
  assert.ok(Array.isArray(snapshot), 'schema snapshot must be an array');
  return snapshot as SnapshotObject[];
}

const constraintProbe = String.raw`
import json, sqlite3, sys

def as_bytes(value):
    return bytes.fromhex(value)

def is_uuid(value):
    try:
        return int(len(bytes(value)) == 16)
    except Exception:
        return 0

def is_uuid_v7(value):
    try:
        raw = bytes(value)
        return int(len(raw) == 16 and (raw[6] >> 4) == 7 and (raw[8] & 0xc0) == 0x80)
    except Exception:
        return 0

def type_matches(value, expected):
    if isinstance(expected, list):
        return any(type_matches(value, item) for item in expected)
    if expected == 'object': return isinstance(value, dict)
    if expected == 'array': return isinstance(value, list)
    if expected == 'string': return isinstance(value, str)
    if expected == 'integer': return isinstance(value, int) and not isinstance(value, bool)
    if expected == 'number': return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == 'null': return value is None
    return True

def valid_schema(schema, value):
    if 'type' in schema and not type_matches(value, schema['type']): return False
    if 'enum' in schema and value not in schema['enum']: return False
    if isinstance(value, dict):
        if any(key not in value for key in schema.get('required', [])): return False
        if schema.get('additionalProperties') is False and any(key not in schema.get('properties', {}) for key in value): return False
        return all(valid_schema(schema.get('properties', {}).get(key, {}), item) for key, item in value.items())
    if isinstance(value, list):
        if len(value) < schema.get('minItems', 0) or len(value) > schema.get('maxItems', len(value)): return False
        if schema.get('uniqueItems') and len({json.dumps(item, sort_keys=True) for item in value}) != len(value): return False
        return all(valid_schema(schema.get('items', {}), item) for item in value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value >= schema.get('minimum', value) and value <= schema.get('maximum', value)
    return True

def jsonschema_matches(schema_text, value_text):
    try: return int(valid_schema(json.loads(schema_text), json.loads(value_text)))
    except Exception: return 0

db = sqlite3.connect(sys.argv[1], timeout=5)
db.isolation_level = None
db.execute('PRAGMA foreign_keys = ON')
db.create_function('is_uuid', 1, is_uuid)
db.create_function('is_uuid_v7', 1, is_uuid_v7)
db.create_function('jsonschema_matches', 2, jsonschema_matches)
users = [as_bytes(value) for value in sys.argv[2:5]]
game_id, round_id, team_id, player_a_id, player_b_id = [as_bytes(value) for value in sys.argv[5:10]]

def failure(fn):
    try:
        fn()
        return {'accepted': True, 'error': ''}
    except (sqlite3.IntegrityError, sqlite3.OperationalError) as error:
        return {'accepted': False, 'error': str(error)}

def question(row_id, source_id, metadata=None):
    return (row_id, source_id, None, 'category', 'subcategory', 'easy', 'question', 'answer a', 'answer b', 'answer c', 'answer d', 1.5, metadata, None)

def insert_question(row):
    db.execute('INSERT INTO questions (id, source_id, external_id, category, subcategory, difficulty, question, answer_a, answer_b, answer_c, answer_d, level, metadata, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', row)

def insert_profile(identifier, name):
    db.execute('INSERT INTO profiles (id, display_name) VALUES (?, ?)', (identifier, name))

results = {'foreign_keys': db.execute('PRAGMA foreign_keys').fetchone()[0]}
results['uuid_semantics'] = {'malformed_false': not bool(is_uuid(b'bad')), 'sixteen_byte_true': bool(is_uuid(b'X' * 16))}
results['native_linkage'] = {}
results['native_linkage']['existing_profiles'] = db.execute('SELECT count(*) FROM profiles WHERE id IN (?, ?, ?)', users).fetchone()[0]
results['native_linkage']['malformed_rejected'] = not failure(lambda: insert_profile(b'bad', 'malformed'))['accepted']
results['native_linkage']['absent_native_rejected'] = not failure(lambda: insert_profile(b'Y' * 16, 'absent'))['accepted']
results['native_linkage']['duplicate_existing_rejected'] = not failure(lambda: insert_profile(users[1], 'wrong-caller'))['accepted']

insert_question(question(901, 'constraint-source-null', None))
insert_question(question(902, 'constraint-source-empty', ''))
metadata = db.execute('SELECT metadata FROM questions WHERE id IN (901, 902) ORDER BY id').fetchall()
results['questions'] = {
    'positive_integer_ids': db.execute('SELECT id FROM questions WHERE id IN (901, 902) ORDER BY id').fetchall() == [(901,), (902,)],
    'source_unique_rejected': not failure(lambda: insert_question(question(903, 'constraint-source-null', None)))['accepted'],
    'zero_id_rejected': not failure(lambda: insert_question(question(0, 'constraint-source-zero', None)))['accepted'],
    'metadata_null_empty_fidelity': metadata == [(None,), ('',)],
}
results['game_setup'] = {}
db.execute("INSERT INTO games (id, host_id, join_code, title, lifecycle) VALUES (?, ?, 'CROSS1', 'Constraint game', 'ready')", (game_id, users[0]))
db.execute("INSERT INTO rounds (id, game_id, ordinal, title) VALUES (?, ?, 1, 'Round one')", (round_id, game_id))
db.execute("INSERT INTO game_teams (id, game_id, name) VALUES (?, ?, 'Alpha')", (team_id, game_id))
db.execute('INSERT INTO game_players (id, game_id, user_id, team_id) VALUES (?, ?, ?, ?)', (player_a_id, game_id, users[0], team_id))
db.execute('INSERT INTO game_players (id, game_id, user_id, team_id) VALUES (?, ?, ?, ?)', (player_b_id, game_id, users[1], team_id))
second_game = as_bytes(sys.argv[10])
second_round = as_bytes(sys.argv[11])
second_player = as_bytes(sys.argv[12])
db.execute("INSERT INTO games (id, host_id, join_code, title) VALUES (?, ?, 'CROSS2', 'Other game')", (second_game, users[0]))
results['game_setup']['cross_game_composite_fk_rejected'] = not failure(lambda: db.execute('INSERT INTO game_players (id, game_id, user_id, team_id) VALUES (?, ?, ?, ?)', (second_player, second_game, users[1], team_id)))['accepted']
results['game_setup']['duplicate_membership_rejected'] = not failure(lambda: db.execute('INSERT INTO game_players (id, game_id, user_id) VALUES (?, ?, ?)', (as_bytes(sys.argv[13]), game_id, users[1])))['accepted']
results['game_setup']['duplicate_team_name_rejected'] = not failure(lambda: db.execute("INSERT INTO game_teams (id, game_id, name) VALUES (?, ?, 'Alpha')", (as_bytes(sys.argv[14]), game_id)))['accepted']
results['game_setup']['duplicate_round_order_rejected'] = not failure(lambda: db.execute("INSERT INTO rounds (id, game_id, ordinal, title) VALUES (?, ?, 1, 'Duplicate')", (second_round, game_id)))['accepted']
results['game_setup']['partial_round_start_state_rejected'] = not failure(lambda: db.execute("INSERT INTO game_state_public (id, phase) VALUES (?, 'round-start')", (second_game,)))['accepted']
results['game_setup']['partial_round_end_state_rejected'] = not failure(lambda: db.execute("INSERT INTO game_state_public (id, phase) VALUES (?, 'round-end')", (second_game,)))['accepted']
results['game_setup']['partial_round_play_state_rejected'] = not failure(lambda: db.execute("INSERT INTO game_state_public (id, phase) VALUES (?, 'round-play')", (second_game,)))['accepted']
results['game_setup']['host_immutability_rejected'] = not failure(lambda: db.execute('UPDATE games SET host_id = ? WHERE id = ?', (users[1], game_id)))['accepted']

valid_bucket = 'actor:018f47d1-8b42-7abc-9def-0123456789ab'
valid_bucket_result = failure(lambda: db.execute('INSERT INTO pairing_limits (id) VALUES (?)', (valid_bucket,)))
invalid_bucket_result = failure(lambda: db.execute("INSERT INTO pairing_limits (id) VALUES ('actor:not-a-uuid')"))
negative_block_result = failure(lambda: db.execute('INSERT INTO pairing_limits (id, blocked_until) VALUES (?, -1)', ('actor:018f47d1-8b42-7abc-9def-1123456789ab',)))
results['pairing_limits'] = {
    'valid_actor_bucket_accepted': valid_bucket_result['accepted'],
    'invalid_actor_bucket_rejected': not invalid_bucket_result['accepted'],
    'negative_blocked_until_rejected': not negative_block_result['accepted'],
    'errors': [valid_bucket_result['error'], invalid_bucket_result['error'], negative_block_result['error']],
}
valid_operation = '018f47d1-8b42-7abc-9def-0123456789ab'
db.execute('INSERT INTO audit_events (actor_user_id, operation_id, entity_type, entity_id, action, request_hash, after_version, outcome) VALUES (?, ?, \'profile\', \'profile-fixture\', \'create\', ?, 0, \'success\')', (users[0], valid_operation, b'X' * 32))
results['audit_constraints'] = {
    'valid_actor_and_action_accepted': True,
    'malformed_actor_rejected': not failure(lambda: db.execute('INSERT INTO audit_events (actor_user_id, operation_id, entity_type, entity_id, action, request_hash, after_version, outcome) VALUES (?, ?, \'profile\', \'bad-actor\', \'create\', ?, 0, \'success\')', (b'bad', '018f47d1-8b42-7abc-9def-1123456789ab', b'Y' * 32)))['accepted'],
    'unknown_action_rejected': not failure(lambda: db.execute('INSERT INTO audit_events (actor_user_id, operation_id, entity_type, entity_id, action, request_hash, after_version, outcome) VALUES (?, ?, \'profile\', \'bad-action\', \'not-allowlisted\', ?, 0, \'success\')', (users[0], '018f47d1-8b42-7abc-9def-2123456789ab', b'Z' * 32)))['accepted'],
}

db.execute('BEGIN')
insert_question(question(904, 'rollback-source', None))
try:
    insert_question(question(905, 'constraint-source-null', None))
    rollback_failed = False
except (sqlite3.IntegrityError, sqlite3.OperationalError):
    rollback_failed = True
    db.execute('ROLLBACK')
results['rollback'] = {
    'second_write_failed': rollback_failed,
    'first_write_absent_after_rollback': db.execute("SELECT count(*) FROM questions WHERE source_id = 'rollback-source'").fetchone()[0] == 0,
}
trigger_names = {row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type = 'trigger'")}
results['guards'] = {
    'history_insert_match': 'used_question_history_question_match_insert' in trigger_names,
    'history_update_match': 'used_question_history_question_match_update' in trigger_names,
    'assignment_insert_match': 'assignment_private_question_match_insert' in trigger_names,
    'assignment_update_match': 'assignment_private_question_match_update' in trigger_names,
}
results['foreign_key_check'] = db.execute('PRAGMA foreign_key_check').fetchall() == []
print(json.dumps(results, sort_keys=True))
db.close()
`;

const deferredProbe = String.raw`
import json, sqlite3, sys

def as_bytes(value): return bytes.fromhex(value)
def is_uuid(value):
    try: return int(len(bytes(value)) == 16)
    except Exception: return 0
def is_uuid_v7(value):
    try:
        raw = bytes(value)
        return int(len(raw) == 16 and (raw[6] >> 4) == 7 and (raw[8] & 0xc0) == 0x80)
    except Exception: return 0
def jsonschema_matches(schema_text, value_text):
    try: json.loads(schema_text); json.loads(value_text); return 1
    except Exception: return 0

db = sqlite3.connect(sys.argv[1], timeout=5)
db.isolation_level = None
db.execute('PRAGMA foreign_keys = ON')
db.create_function('is_uuid', 1, is_uuid)
db.create_function('is_uuid_v7', 1, is_uuid_v7)
db.create_function('jsonschema_matches', 2, jsonschema_matches)
host = as_bytes(sys.argv[2])
ids = [as_bytes(value) for value in sys.argv[3:15]]

def insert_base(game_id, round_id, question_id, assignment_id, game_code, history_id):
    db.execute('INSERT INTO games (id, host_id, join_code, title) VALUES (?, ?, ?, ?)', (game_id, host, game_code, 'Deferred probe'))
    db.execute("INSERT INTO rounds (id, game_id, ordinal, title) VALUES (?, ?, 1, 'Probe round')", (round_id, game_id))
    db.execute('INSERT INTO questions (id, source_id, category, subcategory, difficulty, question, answer_a, answer_b, answer_c, answer_d) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', (question_id, 'deferred-' + game_code, 'category', 'subcategory', 'easy', 'question', 'answer a', 'answer b', 'answer c', 'answer d'))
    db.execute("INSERT INTO game_questions (id, game_id, round_id, ordinal, question_text, choices) VALUES (?, ?, ?, 1, 'Probe question', '{\"A\":\"one\",\"B\":\"two\",\"C\":\"three\",\"D\":\"four\"}')", (assignment_id, game_id, round_id))

def partners(assignment_id, question_id, game_id, history_id):
    db.execute("INSERT INTO assignment_private (assignment_id, question_id, permutation, correct_label) VALUES (?, ?, '[0,1,2,3]', 'A')", (assignment_id, question_id))
    db.execute("INSERT INTO used_question_history (id, host_id, question_id, game_id, assignment_id, operation_id) VALUES (?, ?, ?, ?, ?, '018f47d1-8b42-7abc-9def-0123456789ab')", (history_id, host, question_id, game_id, assignment_id))

sql = {name: db.execute('SELECT sql FROM sqlite_schema WHERE type = \'table\' AND name = ?', (name,)).fetchone()[0] for name in ('game_questions', 'assignment_private', 'used_question_history')}
result = {
    'foreign_keys': db.execute('PRAGMA foreign_keys').fetchone()[0],
    'deferred_sql_survives': all('DEFERRABLE INITIALLY DEFERRED' in sql[name].upper() for name in ('game_questions', 'used_question_history')),
    'foreign_key_counts': {name: len(db.execute('PRAGMA foreign_key_list(' + name + ')').fetchall()) for name in sql},
}
result['incomplete'] = {'stage': None, 'committed': False, 'error': ''}
try:
    db.execute('BEGIN')
    insert_base(ids[0], ids[1], 911, ids[2], 'DEFR01', 9111)
    result['incomplete']['stage'] = 'commit'
    db.execute('COMMIT')
    result['incomplete']['committed'] = True
except Exception as error:
    result['incomplete']['error'] = str(error)
    if result['incomplete']['stage'] is None: result['incomplete']['stage'] = 'game_question'
    db.execute('ROLLBACK')
result['complete'] = {'stage': None, 'committed': False, 'error': ''}
try:
    db.execute('BEGIN')
    insert_base(ids[3], ids[4], 912, ids[5], 'DEFR02', 9112)
    partners(ids[5], 912, ids[3], 9112)
    result['complete']['stage'] = 'commit'
    db.execute('COMMIT')
    result['complete']['committed'] = True
except Exception as error:
    result['complete']['error'] = str(error)
    if result['complete']['stage'] is None: result['complete']['stage'] = 'partner-insert'
    db.execute('ROLLBACK')
db.execute('INSERT INTO questions (id, source_id, category, subcategory, difficulty, question, answer_a, answer_b, answer_c, answer_d) VALUES (919, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ('deferred-mismatch-919', 'category', 'subcategory', 'easy', 'mismatch question', 'answer a', 'answer b', 'answer c', 'answer d'))

def mismatch_counts(assignment_id):
    return (
        db.execute('SELECT count(*) FROM assignment_private WHERE assignment_id = ? AND question_id <> 912', (assignment_id,)).fetchone()[0],
        db.execute('SELECT count(*) FROM used_question_history WHERE assignment_id = ? AND question_id <> 912', (assignment_id,)).fetchone()[0],
    )

def mismatch_attempt(action, assignment_id, expected_match, expected_guard):
    outcome = {'rejected': False, 'rolled_back': False, 'match_trigger': False, 'append_only_trigger': False, 'immutable_trigger': False, 'error': ''}
    db.execute('BEGIN')
    try:
        action()
    except Exception as error:
        outcome['rejected'] = True
        outcome['error'] = str(error)
        outcome['match_trigger'] = expected_match in outcome['error']
        outcome['append_only_trigger'] = 'question history is append-only' in outcome['error']
        outcome['immutable_trigger'] = 'private assignment is immutable' in outcome['error']
        db.execute('ROLLBACK')
    else:
        db.execute('ROLLBACK')
    outcome['rolled_back'] = mismatch_counts(assignment_id) == (0, 0)
    outcome['expected_guard'] = expected_guard in outcome['error']
    return outcome

def insert_disposable_base(game_id, round_id, assignment_id, game_code):
    db.execute('INSERT INTO games (id, host_id, join_code, title) VALUES (?, ?, ?, ?)', (game_id, host, game_code, 'Mismatch probe'))
    db.execute("INSERT INTO rounds (id, game_id, ordinal, title) VALUES (?, ?, 1, 'Mismatch round')", (round_id, game_id))
    db.execute("INSERT INTO game_questions (id, game_id, round_id, ordinal, question_text, choices) VALUES (?, ?, ?, 1, 'Mismatch question', '{\"A\":\"one\",\"B\":\"two\",\"C\":\"three\",\"D\":\"four\"}')", (assignment_id, game_id, round_id))

history_insert = mismatch_attempt(
    lambda: (
        insert_disposable_base(ids[6], ids[7], ids[8], 'MIS001'),
        db.execute("INSERT INTO assignment_private (assignment_id, question_id, permutation, correct_label) VALUES (?, 912, '[0,1,2,3]', 'A')", (ids[8],)),
        db.execute("INSERT INTO used_question_history (id, host_id, question_id, game_id, assignment_id, operation_id) VALUES (9211, ?, 919, ?, ?, '018f47d1-8b42-7abc-9def-1123456789ab')", (host, ids[6], ids[8])),
    ),
    ids[8],
    'question history question does not match assignment',
    'question history question does not match assignment',
)
assignment_insert = mismatch_attempt(
    lambda: (
        insert_disposable_base(ids[9], ids[10], ids[11], 'MIS002'),
        db.execute("INSERT INTO used_question_history (id, host_id, question_id, game_id, assignment_id, operation_id) VALUES (9212, ?, 912, ?, ?, '018f47d1-8b42-7abc-9def-2123456789ab')", (host, ids[9], ids[11])),
        db.execute("INSERT INTO assignment_private (assignment_id, question_id, permutation, correct_label) VALUES (?, 919, '[0,1,2,3]', 'A')", (ids[11],)),
    ),
    ids[11],
    'assignment question does not match question history',
    'assignment question does not match question history',
)
history_update = mismatch_attempt(
    lambda: db.execute('UPDATE used_question_history SET question_id = 919 WHERE id = 9112'),
    ids[5],
    'question history question does not match assignment',
    'question history is append-only',
)
assignment_update = mismatch_attempt(
    lambda: db.execute('UPDATE assignment_private SET question_id = 919 WHERE assignment_id = ?', (ids[5],)),
    ids[5],
    'assignment question does not match question history',
    'private assignment is immutable',
)
result['mismatch'] = {
    'history_insert': history_insert,
    'history_update': history_update,
    'assignment_insert': assignment_insert,
    'assignment_update': assignment_update,
    'no_partial_mismatched_rows': all(
        db.execute('SELECT count(*) FROM assignment_private WHERE assignment_id = ?', (assignment_id,)).fetchone()[0] == 0
        and db.execute('SELECT count(*) FROM used_question_history WHERE assignment_id = ?', (assignment_id,)).fetchone()[0] == 0
        for assignment_id in (ids[8], ids[11])
    ) and mismatch_counts(ids[5]) == (0, 0),
    'valid_partner_intact': db.execute('SELECT question_id FROM assignment_private WHERE assignment_id = ?', (ids[5],)).fetchone() == (912,)
        and db.execute('SELECT question_id FROM used_question_history WHERE id = 9112').fetchone() == (912,),
}
result['rows_after_probe'] = {
    'game_questions': db.execute('SELECT count(*) FROM game_questions WHERE id IN (?, ?)', (ids[2], ids[5])).fetchone()[0],
    'assignment_private': db.execute('SELECT count(*) FROM assignment_private WHERE assignment_id = ?', (ids[5],)).fetchone()[0],
    'used_question_history': db.execute('SELECT count(*) FROM used_question_history WHERE assignment_id = ?', (ids[5],)).fetchone()[0],
}
print(json.dumps(result, sort_keys=True))
db.close()
`;

test('schema-two-depots', { timeout: 120000 }, async t => {
  const stacks: Awaited<ReturnType<typeof startStack>>[] = [];
  t.after(async () => {
    await Promise.allSettled(stacks.map(stack => stack.close()));
  });

  const snapshots: unknown[] = [];
  const generated: Record<string, Schema[]>[] = [];
  for (const depotNumber of [1, 2]) {
    const stack = await startStack({ source: 'backend' });
    stacks.push(stack);
    const ready = await fetch(`${stack.base}/api/records/v1/${stack.readyName}/1`, { signal: AbortSignal.timeout(2000) });
    assert.equal(ready.status, 200, `schema-two-depots depot ${depotNumber}: owned readiness row is unavailable`);

    const depotSchemas: Record<string, Schema[]> = {};
    for (const [api, fields] of Object.entries(SAFE_PROJECTIONS)) {
      depotSchemas[api] = SCHEMA_MODES.map(mode => {
        const schema = requiredSchema(stack, api, mode, `schema-two-depots depot ${depotNumber}`);
        assertSchemaFields(schema, fields, `schema-two-depots depot ${depotNumber} ${api} ${mode}`);
        return schema;
      });
    }
    generated.push(depotSchemas);
    const snapshot = stack.schemaSnapshot();
    const objects = snapshotObjects(snapshot);
    const names = new Set(objects.map(object => object.name));
    for (const table of [
      'profiles', 'questions', 'games', 'rounds', 'game_teams', 'game_players', 'game_questions',
      'assignment_private', 'game_state_public', 'game_answers', 'answer_grades_private',
      'used_question_history', 'displays', 'pairing_limits', 'online', 'audit_events',
    ]) assert.ok(names.has(table), `schema-two-depots depot ${depotNumber}: ${table} table is missing`);
    const sql = new Map(objects.map(object => [object.name, object.sql ?? '']));
    assert.match(sql.get('profiles') ?? '', /CHECK\s*\(is_uuid\(id\)\)/i,
      `schema-two-depots depot ${depotNumber}: profiles must use native is_uuid linkage`);
    assert.doesNotMatch(sql.get('profiles') ?? '', /uuid_v7\(\)/i,
      `schema-two-depots depot ${depotNumber}: profiles must not generate application UUIDs`);
    assert.match(sql.get('questions') ?? '', /id INTEGER PRIMARY KEY/i,
      `schema-two-depots depot ${depotNumber}: questions must use an integer primary key`);
    assert.match(sql.get('questions') ?? '', /source_id TEXT NOT NULL UNIQUE/i,
      `schema-two-depots depot ${depotNumber}: questions source_id must be unique`);
    snapshots.push(snapshot);
  }

  assert.deepEqual(generated[1], generated[0], 'schema-two-depots: generated schemas diverge between fresh depots');
  assert.deepEqual(snapshots[1], snapshots[0], 'schema-two-depots: normalized DDL/FK/index schemas diverge');
  for (const [index, stack] of stacks.entries()) {
    await stack.restart();
    assert.deepEqual(stack.schemaSnapshot(), snapshots[index],
      `schema-two-depots depot ${index + 1}: restart changed normalized schema`);
  }
});

test('projection-rest-expand-sse', { timeout: 90000 }, async t => {
  const stack = await startStack({ source: 'backend' });
  t.after(() => stack.close());
  const host = initClient(stack.base);
  const member = initClient(stack.base);
  const foreign = initClient(stack.base);
  await host.login(stack.accounts[0].email, stack.accounts[0].password);
  await member.login(stack.accounts[1].email, stack.accounts[1].password);
  await foreign.login(stack.accounts[2].email, stack.accounts[2].password);

  const rowsByApi = new Map<string, Record<string, unknown>>();
  for (const [apiName, fields] of Object.entries(SAFE_PROJECTIONS)) {
    const api = host.records(apiName);
    const list = await bounded(api.list({ pagination: { limit: 100 }, count: true, order: ['id'] }), `${apiName} list`);
    assert.equal(typeof list.total_count, 'number', `projection-rest-expand-sse ${apiName}: count response is missing total_count`);
    assert.ok(list.records.length > 0, `projection-rest-expand-sse ${apiName}: fixture has no authorized row`);
    for (const record of list.records) assertSafeRecord(record, fields, `projection-rest-expand-sse ${apiName} list`);
    const row = list.records[0] as Record<string, unknown>;
    rowsByApi.set(apiName, row);
    if (apiName === 'profiles_public') {
      assert.ok(!list.records.some(record => record.id === stack.profileIds[2]),
        'projection-rest-expand-sse profiles_public: unrelated profile escaped target-membership scope');
    }
    assertSafeRecord(await bounded(api.read(row.id as string), `${apiName} read`), fields, `projection-rest-expand-sse ${apiName} read`);
    const filtered = await bounded(api.list({
      pagination: { limit: 100 }, count: true, order: ['id'],
      filters: [{ column: 'id', op: 'equal' as const, value: row.id as string }],
    }), `${apiName} filtered list`);
    assert.equal(filtered.total_count, 1, `projection-rest-expand-sse ${apiName}: safe ID filter did not select its row`);
    assert.equal(filtered.records.length, 1, `projection-rest-expand-sse ${apiName}: filtered list returned the wrong number of rows`);

    try {
      const expanded = await bounded(api.list({ expand: ['private', '_user', 'game'] }), `${apiName} expand`);
      for (const record of expanded.records) assertSafeRecord(record, fields, `projection-rest-expand-sse ${apiName} expand`);
    } catch (error) {
      assert.ok(isDenied(error), `projection-rest-expand-sse ${apiName}: unexpected expand failure (${describeError(error)})`);
    }
  }

  const excludedColumns: Record<string, string> = {
    profiles_public: 'avatar_file', games_public: 'host_id', games_host: 'deleted_at', game_teams: 'created_at',
    game_players: 'created_at', game_state_public: 'private_key', displays_public: 'device_user_id', online: 'private_session',
  };
  for (const [apiName, column] of Object.entries(excludedColumns)) {
    const response = await fetch(`${stack.base}/api/records/v1/${apiName}?filter[${column}]=sentinel&order=${column}`, {
      headers: host.headers(), signal: AbortSignal.timeout(2000),
    });
    assert.ok(DENIED_STATUSES.includes(response.status),
      `projection-rest-expand-sse ${apiName}: excluded ${column} filter/order unexpectedly returned HTTP ${response.status}`);
  }

  for (const [apiName, row] of rowsByApi) {
    for (const [method, body] of [
      ['POST', JSON.stringify({ id: row.id })],
      ['PATCH', JSON.stringify({ version: 1 })],
      ['DELETE', undefined],
    ] as const) {
      const headers = new Headers(host.headers());
      if (body) headers.set('content-type', 'application/json');
      const response = await fetch(`${stack.base}/api/records/v1/${apiName}/${method === 'POST' ? '' : row.id}`, {
        method, body, headers, signal: AbortSignal.timeout(2000),
      });
      assert.ok(DENIED_STATUSES.includes(response.status),
        `projection-rest-expand-sse ${apiName}: direct ${method} mutation unexpectedly returned HTTP ${response.status}`);
    }
  }
  for (const privateApi of PRIVATE_APIS) {
    const read = await fetch(`${stack.base}/api/records/v1/${privateApi}/1`, {
      headers: host.headers(), signal: AbortSignal.timeout(2000),
    });
    assert.notEqual(read.status, 200,
      `projection-rest-expand-sse: unconfigured private API ${privateApi} unexpectedly returned a row`);
    const list = await fetch(`${stack.base}/api/records/v1/${privateApi}?count=true`, {
      headers: host.headers(), signal: AbortSignal.timeout(2000),
    });
    assert.notEqual(list.status, 200,
      `projection-rest-expand-sse: unconfigured private API ${privateApi} unexpectedly listed data`);
  }

  for (const apiName of Object.keys(SAFE_PROJECTIONS)) {
    const row = rowsByApi.get(apiName)!;
    const api = foreign.records(apiName);
    try {
      const foreignList = await bounded(api.list({
        pagination: { limit: 100 }, count: true,
        filters: [{ column: 'id', op: 'equal' as const, value: row.id as string }],
      }), `foreign ${apiName} list`);
      assert.equal(foreignList.total_count, 0, `projection-rest-expand-sse foreign ${apiName}: count leaked a foreign row`);
      assert.equal(foreignList.records.length, 0, `projection-rest-expand-sse foreign ${apiName}: filter returned a foreign row`);
    } catch (error) {
      assert.ok(isDenied(error), `projection-rest-expand-sse foreign ${apiName}: unexpected list error (${describeError(error)})`);
    }
    await assert.rejects(api.read(row.id as string), error => isDenied(error),
      `projection-rest-expand-sse foreign ${apiName}: direct read was not denied`);
    {
      let opened = false;
      try {
        const stream = await bounded(api.subscribe(row.id as string), `foreign ${apiName} SSE`);
        opened = true;
        const reader = stream.getReader();
        await bounded(reader.cancel(), `foreign ${apiName} SSE cancellation`);
        reader.releaseLock();
        throw new Error(`projection-rest-expand-sse foreign ${apiName}: direct SSE was not denied`);
      } catch (error) {
        if (opened) throw error;
        assert.ok(isDenied(error), `projection-rest-expand-sse foreign ${apiName}: unexpected SSE error (${describeError(error)})`);
      }
    }
  }

  const profileId = stack.profileIds[0];
  const stream = await bounded(host.records('profiles_public').subscribeAll({
    filters: [{ column: 'id', op: 'equal' as const, value: profileId }],
  }), 'authorized profile SSE');
  const reader = stream.getReader();
  // Every P02 alias is intentionally read-only, so no application mutation is available
  // to manufacture an event here. Exact event payload keys belong with the first owning
  // mutation handler; this check proves the authorized filtered stream can be opened and
  // is always cancelled without claiming event delivery or revocation semantics.
  assert.equal(typeof reader.read, 'function', 'projection-rest-expand-sse: authorized SSE reader unavailable');
  await bounded(reader.cancel(), 'authorized profile SSE cancellation');
  reader.releaseLock();
  assert.ok(member.user()?.id && foreign.user()?.id, 'projection-rest-expand-sse: ordinary actor identities are missing');
});

test('constraint-partial-races', { timeout: 90000 }, async t => {
  const stack = await startStack({ source: 'backend' });
  t.after(() => stack.close());
  const constraintIds = [v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex()];
  const constraintOutput = await stack.offlineSqlite(constraintProbe, [
    ...stack.profileIds.map(hexId), ...constraintIds,
  ]);
  assert.equal(constraintOutput.status, 0, `constraint-partial-races: SQLite constraint probe failed (${constraintOutput.stderr})`);
  const probe = JSON.parse(constraintOutput.stdout) as ConstraintProbe;
  const failures: Failure[] = [];
  const expectTrue = (label: string, value: unknown) => {
    if (value !== true) failures.push(`${label}: expected true, got ${JSON.stringify(value)}`);
  };
  expectTrue('foreign-key enforcement enabled', probe.foreign_keys === 1);
  expectTrue('is_uuid rejects malformed IDs', probe.uuid_semantics?.malformed_false);
  expectTrue('is_uuid accepts 16-byte IDs', probe.uuid_semantics?.sixteen_byte_true);
  expectTrue('native profile positive linkage', probe.native_linkage?.existing_profiles === stack.profileIds.length);
  expectTrue('malformed native profile rejected', probe.native_linkage?.malformed_rejected);
  expectTrue('absent native profile rejected by FK', probe.native_linkage?.absent_native_rejected);
  expectTrue('duplicate existing profile binding rejected', probe.native_linkage?.duplicate_existing_rejected);
  expectTrue('positive integer/source metadata contract', probe.questions?.positive_integer_ids);
  expectTrue('unique source_id rejected', probe.questions?.source_unique_rejected);
  expectTrue('non-positive question ID rejected', probe.questions?.zero_id_rejected);
  expectTrue('NULL/empty metadata fidelity', probe.questions?.metadata_null_empty_fidelity);
  expectTrue('cross-game composite FK rejected', probe.game_setup?.cross_game_composite_fk_rejected);
  expectTrue('duplicate membership rejected', probe.game_setup?.duplicate_membership_rejected);
  expectTrue('duplicate team name rejected', probe.game_setup?.duplicate_team_name_rejected);
  expectTrue('duplicate round ordering rejected', probe.game_setup?.duplicate_round_order_rejected);
  expectTrue('invalid partial round-start state rejected', probe.game_setup?.partial_round_start_state_rejected);
  expectTrue('invalid partial round-end state rejected', probe.game_setup?.partial_round_end_state_rejected);
  expectTrue('invalid partial round-play state rejected', probe.game_setup?.partial_round_play_state_rejected);
  expectTrue('immutable game host rejected', probe.game_setup?.host_immutability_rejected);
  expectTrue('valid pairing actor bucket accepted', probe.pairing_limits?.valid_actor_bucket_accepted);
  expectTrue('invalid pairing actor bucket rejected', probe.pairing_limits?.invalid_actor_bucket_rejected);
  expectTrue('negative pairing block rejected', probe.pairing_limits?.negative_blocked_until_rejected);
  expectTrue('valid audit actor/action accepted', probe.audit_constraints?.valid_actor_and_action_accepted);
  expectTrue('malformed audit actor rejected', probe.audit_constraints?.malformed_actor_rejected);
  expectTrue('unknown audit action rejected', probe.audit_constraints?.unknown_action_rejected);
  expectTrue('second write failed', probe.rollback?.second_write_failed);
  expectTrue('first write rolled back', probe.rollback?.first_write_absent_after_rollback);
  for (const [name, value] of Object.entries(probe.guards ?? {})) expectTrue(`cross-row guard ${name}`, value);
  expectTrue('foreign_key_check clean after fixture', probe.foreign_key_check);

  const hostProbeIds = [v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex()];
  const hostProbeOutput = await stack.offlineSqlite(deferredProbe, [hexId(stack.profileIds[0]), ...hostProbeIds]);
  assert.equal(hostProbeOutput.status, 0, `constraint-partial-races: SQLite constraint probe failed (${hostProbeOutput.stderr})`);
  const hostProbe = JSON.parse(hostProbeOutput.stdout) as HostProbe;
  expectTrue('SQLite foreign keys enabled for migration probe', hostProbe.foreign_keys === 1);
  expectTrue('migration clauses survive SQLite DDL storage', hostProbe.deferred_sql_survives);
  expectTrue('SQLite incomplete partner transaction fails at commit', hostProbe.incomplete?.stage === 'commit' && hostProbe.incomplete?.committed === false);
  expectTrue('SQLite complete partner transaction commits atomically', hostProbe.complete?.committed === true);
  expectTrue('history insert mismatch rejected by match trigger', hostProbe.mismatch?.history_insert?.rejected && hostProbe.mismatch.history_insert.match_trigger);
  expectTrue('history insert mismatch transaction rolled back', hostProbe.mismatch?.history_insert?.rolled_back);
  expectTrue('history update mismatch rejected by append-only or match guard', hostProbe.mismatch?.history_update?.rejected
    && (hostProbe.mismatch.history_update.append_only_trigger || hostProbe.mismatch.history_update.match_trigger));
  expectTrue('history update mismatch transaction rolled back', hostProbe.mismatch?.history_update?.rolled_back);
  expectTrue('assignment insert mismatch rejected by match trigger', hostProbe.mismatch?.assignment_insert?.rejected && hostProbe.mismatch.assignment_insert.match_trigger);
  expectTrue('assignment insert mismatch transaction rolled back', hostProbe.mismatch?.assignment_insert?.rolled_back);
  expectTrue('assignment update mismatch rejected by immutable or match guard', hostProbe.mismatch?.assignment_update?.rejected
    && (hostProbe.mismatch.assignment_update.immutable_trigger || hostProbe.mismatch.assignment_update.match_trigger));
  expectTrue('assignment update mismatch transaction rolled back', hostProbe.mismatch?.assignment_update?.rolled_back);
  expectTrue('no partial mismatched partner rows remain', hostProbe.mismatch?.no_partial_mismatched_rows);
  expectTrue('valid complete partner remains intact', hostProbe.mismatch?.valid_partner_intact);

  const pinnedIds = [v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex(), v7Hex()];
  const pinnedClient = initClient(stack.base);
  await pinnedClient.login(stack.accounts[0].email, stack.accounts[0].password);
  const pinnedResponse = await pinnedClient.fetch('/__p02/deferred-partner-probe', {
    method: 'POST',
    body: JSON.stringify({
      incomplete_game_id: encodedId(pinnedIds[0]),
      incomplete_round_id: encodedId(pinnedIds[1]),
      incomplete_assignment_id: encodedId(pinnedIds[2]),
      complete_game_id: encodedId(pinnedIds[3]),
      complete_round_id: encodedId(pinnedIds[4]),
      complete_assignment_id: encodedId(pinnedIds[5]),
      incomplete_history_id: 9211,
      complete_history_id: 9212,
    }),
  });
  assert.equal(pinnedResponse.status, 200, `constraint-partial-races: pinned embedded SQLite probe returned HTTP ${pinnedResponse.status}`);
  const deferred = await pinnedResponse.json() as DeferredProbe;
  expectTrue('pinned embedded SQLite foreign keys enabled', deferred.foreign_keys === 1);
  // The host SQLite probe confirms the clauses remain in sqlite_schema; this pinned
  // endpoint is the authoritative behavior check for TrailBase's embedded connection.
  expectTrue('pinned incomplete partner transaction fails at commit', deferred.incomplete?.stage === 'commit' && deferred.incomplete?.committed === false);
  expectTrue('pinned complete partner transaction commits atomically', deferred.complete?.committed === true);
  if (deferred.incomplete?.stage !== 'commit' || deferred.complete?.committed !== true) {
    failures.push(`BLOCKER deferred-partner invariant unsupported by pinned v0.33.14: pinned=${JSON.stringify(deferred)} host=${JSON.stringify(hostProbe)}; retain this gate red until a measured schema-only workaround preserves commit semantics`);
  }

  assert.deepEqual(failures, [], `constraint-partial-races: real pinned constraint checks failed\n${failures.join('\n')}\nprobe=${JSON.stringify(probe)}\npinned=${JSON.stringify(deferred)}`);
});
