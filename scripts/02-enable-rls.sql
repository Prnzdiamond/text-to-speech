-- Enable Row Level Security (RLS)
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE reading_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for user_preferences
CREATE POLICY "Users can view their own preferences" ON user_preferences FOR
SELECT USING (auth.uid () = user_id);

CREATE POLICY "Users can insert their own preferences" ON user_preferences FOR
INSERT
WITH
    CHECK (auth.uid () = user_id);

CREATE POLICY "Users can update their own preferences" ON user_preferences FOR
UPDATE USING (auth.uid () = user_id);

CREATE POLICY "Users can delete their own preferences" ON user_preferences FOR DELETE USING (auth.uid () = user_id);

-- Create RLS policies for reading_history
CREATE POLICY "Users can view their own reading history" ON reading_history FOR
SELECT USING (auth.uid () = user_id);

CREATE POLICY "Users can insert their own reading history" ON reading_history FOR
INSERT
WITH
    CHECK (auth.uid () = user_id);

CREATE POLICY "Users can update their own reading history" ON reading_history FOR
UPDATE USING (auth.uid () = user_id);

CREATE POLICY "Users can delete their own reading history" ON reading_history FOR DELETE USING (auth.uid () = user_id);