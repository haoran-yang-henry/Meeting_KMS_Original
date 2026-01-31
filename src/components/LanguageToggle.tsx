import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';

export const LanguageToggle = () => {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'de' : 'en';
    i18n.changeLanguage(newLang);
    localStorage.setItem('language', newLang);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleLanguage}
      className="flex items-center gap-1.5"
    >
      <Globe className="h-4 w-4" />
      <span className="uppercase font-medium">{i18n.language}</span>
    </Button>
  );
};
