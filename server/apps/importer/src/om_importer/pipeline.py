from pathlib import Path
from zipfile import ZipFile, BadZipFile
from .common import package
from .xlsx import extract_xlsx
from .docx import extract_docx


def check_source(path):
    extension=path.suffix.lower()
    if extension not in ('.xlsx','.docx'):
        raise ValueError('Supported formats are .xlsx and .docx')
    if path.stat().st_size>25_000_000:
        raise ValueError('Source exceeds 25 MB limit')
    try:
        with ZipFile(path) as archive:
            entries=archive.infolist()
            if len(entries)>10000 or sum(e.file_size for e in entries)>100_000_000:
                raise ValueError('OOXML uncompressed size limit exceeded')
            expected='xl/workbook.xml' if extension=='.xlsx' else 'word/document.xml'
            if expected not in archive.namelist():
                raise ValueError('OOXML contents do not match source extension')
            for entry in entries:
                if 'vbaproject' in entry.filename.lower():
                    raise ValueError('Macros are unsupported')
                if entry.filename.endswith(('.xml','.rels')):
                    content=archive.read(entry)
                    if b'<!DOCTYPE' in content.upper() or b'<!ENTITY' in content.upper():
                        raise ValueError('XML entity declarations are unsupported')
                    if extension=='.docx' and entry.filename=='word/document.xml':
                        from lxml import etree
                        root=etree.fromstring(content,parser=etree.XMLParser(resolve_entities=False,no_network=True))
                        ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
                        if root.xpath('//w:txbxContent|//w:ins|//w:del|//w:altChunk',namespaces=ns):
                            raise ValueError('Text boxes, tracked changes, and embedded content require an additional DOCX profile')
    except BadZipFile as exc:
        raise ValueError('Source is not an OOXML package') from exc


def extract(filename, configuration=None):
    path=Path(filename)
    check_source(path)
    from .configuration import validate_config
    from .discovery import default_configuration
    config=validate_config(configuration) if configuration is not None else default_configuration(path)
    if config is not None:
        config=validate_config(config)
        profile=config['profile']
        expected='xlsx' if profile in ('xlsx','cemetery_v1') else 'docx'
        if path.suffix.lower()[1:]!=expected:
            raise ValueError('Configured profile is incompatible with the source format')
    else:
        profile='cemetery_v1' if path.suffix.lower()=='.xlsx' else 'parish_announcements_v1'
    p=package(path,profile)
    if profile in ('xlsx','docx_paragraphs','docx_table'):
        from .generic import extract_xlsx_generic,extract_docx_generic
        p['resource']['name']=config.get('resource_name',path.stem)
        handler=extract_xlsx_generic if profile=='xlsx' else extract_docx_generic
        handler(path,p,config)
    else:
        handler=extract_xlsx if profile=='cemetery_v1' else extract_docx
        handler(path,p)
        if config is not None:
            from .mapping import configure_package
            p=configure_package(p,config)
    from .validation import validate
    validate(p)
    return p


def inspect(filename):
    path=Path(filename)
    check_source(path)
    from .discovery import inspect_source
    return inspect_source(path)
