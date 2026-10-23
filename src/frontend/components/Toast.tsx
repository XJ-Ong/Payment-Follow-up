import { Toaster } from 'sonner';

export default function Toast() {
  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      visibleToasts={3}
      duration={4500}
      offset={24}
      mobileOffset={16}
      toastOptions={{ style: { fontFamily: 'inherit' } }}
    />
  );
}
