import { EMOJI_OPTIONS } from "../../config/settings";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export default function EmojiPicker({
  onSelect,
}: EmojiPickerProps) {
  return (
    <div className="emoji-popover scrollable-emoji">
      {EMOJI_OPTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="emoji-option"
          onClick={() => onSelect(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}