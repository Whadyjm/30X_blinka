import { BorderBeam } from 'border-beam';
import { ChatWorkspace } from '@/features/chat/ChatWorkspace';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { useTheme } from '@/theme/ThemeProvider';
import '@/styles/chat-board.css';

export function AskOli() {
  const reduced = usePrefersReducedMotion();
  const { resolved } = useTheme();

  return <BorderBeam className="ask-oli-board -mx-4 -mt-6 md:mx-0 md:mt-0" size="pulse-outside"
    colorVariant="forest" theme={resolved} strength={0.3} brightness={1.2} saturation={0.8}
    duration={7} glowSize={1.2} staticColors active={!reduced}>
    <ChatWorkspace />
  </BorderBeam>;
}
