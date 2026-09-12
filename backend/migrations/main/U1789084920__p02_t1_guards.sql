-- T1 guards keep authority and append-only identities in the database. Gameplay
-- transitions and CAS writes remain server-only and are not implemented here.

CREATE TRIGGER profiles_immutable_identity
BEFORE UPDATE ON profiles
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'profile identity is immutable');
END;

CREATE TRIGGER games_immutable_identity
BEFORE UPDATE ON games
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.host_id IS NOT OLD.host_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'game identity is immutable');
END;

CREATE TRIGGER games_roster_lock_monotonic
BEFORE UPDATE ON games
FOR EACH ROW
WHEN (OLD.roster_locked_at IS NOT NULL AND NEW.roster_locked_at IS NULL)
  OR (OLD.roster_locked_at IS NOT NULL AND NEW.roster_locked_at IS NOT OLD.roster_locked_at)
BEGIN
  SELECT RAISE(ABORT, 'game roster lock is immutable');
END;

CREATE TRIGGER rounds_immutable_identity
BEFORE UPDATE ON rounds
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.game_id IS NOT OLD.game_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'round identity is immutable');
END;

CREATE TRIGGER game_teams_immutable_identity
BEFORE UPDATE ON game_teams
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.game_id IS NOT OLD.game_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'team identity is immutable');
END;

CREATE TRIGGER game_teams_before_insert_lock
BEFORE INSERT ON game_teams
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM games WHERE id = NEW.game_id AND roster_locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'team membership is locked');
END;

CREATE TRIGGER game_teams_before_update_lock
BEFORE UPDATE ON game_teams
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM games WHERE id = OLD.game_id AND roster_locked_at IS NOT NULL)
  AND NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
  SELECT RAISE(ABORT, 'team membership is locked');
END;

CREATE TRIGGER game_teams_before_delete_lock
BEFORE DELETE ON game_teams
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM games WHERE id = OLD.game_id AND roster_locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'team membership is locked');
END;

CREATE TRIGGER game_players_immutable_identity
BEFORE UPDATE ON game_players
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.game_id IS NOT OLD.game_id
  OR NEW.user_id IS NOT OLD.user_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'player identity is immutable');
END;

CREATE TRIGGER game_players_before_insert_lock
BEFORE INSERT ON game_players
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM games WHERE id = NEW.game_id AND roster_locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'roster is locked');
END;

CREATE TRIGGER game_players_before_insert_team
BEFORE INSERT ON game_players
FOR EACH ROW
WHEN NEW.team_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM game_teams WHERE id = NEW.team_id AND game_id = NEW.game_id AND deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'player team is unavailable');
END;

CREATE TRIGGER game_players_before_update_team
BEFORE UPDATE ON game_players
FOR EACH ROW
WHEN NEW.team_id IS NOT OLD.team_id
  AND (SELECT roster_locked_at FROM games WHERE id = OLD.game_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'roster team is locked');
END;

CREATE TRIGGER game_players_before_update_deleted_team
BEFORE UPDATE OF team_id ON game_players
FOR EACH ROW
WHEN NEW.team_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM game_teams WHERE id = NEW.team_id AND game_id = NEW.game_id AND deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'player team is unavailable');
END;

CREATE TRIGGER game_players_before_delete_lock
BEFORE DELETE ON game_players
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM games WHERE id = OLD.game_id AND roster_locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'roster is locked');
END;

CREATE TRIGGER game_questions_immutable
BEFORE UPDATE ON game_questions
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.game_id IS NOT OLD.game_id OR NEW.round_id IS NOT OLD.round_id
  OR NEW.ordinal IS NOT OLD.ordinal OR NEW.question_text IS NOT OLD.question_text
  OR NEW.choices IS NOT OLD.choices OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'assignment content is immutable');
END;

CREATE TRIGGER assignment_private_immutable
BEFORE UPDATE ON assignment_private
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'private assignment is immutable');
END;

CREATE TRIGGER used_question_history_question_match_insert
BEFORE INSERT ON used_question_history
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_private
  WHERE assignment_id = NEW.assignment_id AND question_id <> NEW.question_id
)
BEGIN
  SELECT RAISE(ABORT, 'question history question does not match assignment');
END;

CREATE TRIGGER used_question_history_question_match_update
BEFORE UPDATE OF assignment_id, question_id ON used_question_history
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_private
  WHERE assignment_id = NEW.assignment_id AND question_id <> NEW.question_id
)
BEGIN
  SELECT RAISE(ABORT, 'question history question does not match assignment');
END;

CREATE TRIGGER used_question_history_immutable
BEFORE UPDATE ON used_question_history
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'question history is append-only');
END;

CREATE TRIGGER used_question_history_no_delete
BEFORE DELETE ON used_question_history
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'question history is append-only');
END;

CREATE TRIGGER assignment_private_question_match_insert
BEFORE INSERT ON assignment_private
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM used_question_history
  WHERE assignment_id = NEW.assignment_id AND question_id <> NEW.question_id
)
BEGIN
  SELECT RAISE(ABORT, 'assignment question does not match question history');
END;

CREATE TRIGGER assignment_private_question_match_update
BEFORE UPDATE OF assignment_id, question_id ON assignment_private
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM used_question_history
  WHERE assignment_id = NEW.assignment_id AND question_id <> NEW.question_id
)
BEGIN
  SELECT RAISE(ABORT, 'assignment question does not match question history');
END;

CREATE TRIGGER game_answers_immutable
BEFORE UPDATE ON game_answers
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'answers are append-only');
END;

CREATE TRIGGER game_answers_no_delete
BEFORE DELETE ON game_answers
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'answers are append-only');
END;

CREATE TRIGGER answer_grades_immutable
BEFORE UPDATE ON answer_grades_private
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'grades are append-only');
END;

CREATE TRIGGER answer_grades_no_delete
BEFORE DELETE ON answer_grades_private
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'grades are append-only');
END;

CREATE TRIGGER state_immutable_identity
BEFORE UPDATE ON game_state_public
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'game state identity is immutable');
END;

CREATE TRIGGER displays_immutable_identity
BEFORE UPDATE ON displays
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.device_user_id IS NOT OLD.device_user_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'display identity is immutable');
END;

CREATE TRIGGER pairing_limits_immutable_identity
BEFORE UPDATE ON pairing_limits
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id
BEGIN
  SELECT RAISE(ABORT, 'pairing bucket identity is immutable');
END;

CREATE TRIGGER online_immutable_identity
BEFORE UPDATE ON online
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.game_id IS NOT OLD.game_id
BEGIN
  SELECT RAISE(ABORT, 'presence identity is immutable');
END;

CREATE TRIGGER audit_events_append_only_update
BEFORE UPDATE ON audit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER audit_events_append_only_delete
BEFORE DELETE ON audit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
