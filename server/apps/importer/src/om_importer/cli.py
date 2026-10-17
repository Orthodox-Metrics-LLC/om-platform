import argparse
import json
from pathlib import Path
from jsonschema import ValidationError
from .pipeline import extract,inspect
from .mapping import configure_package
from .validation import validate


def read_json(filename):
    return json.loads(Path(filename).read_text(encoding='utf-8'))


def write_json(filename,p):
    # Refuse accidental replacement of approved/manual edits.
    with Path(filename).open('x',encoding='utf-8') as stream:
        json.dump(p,stream,ensure_ascii=False,indent=2,allow_nan=False)
        stream.write('\n')


def main():
    parser=argparse.ArgumentParser(description='Configurable OM document-to-JSON engine (no database access)')
    sub=parser.add_subparsers(dest='command',required=True)
    convert=sub.add_parser('extract')
    convert.add_argument('source')
    convert.add_argument('--config',help='JSON field definitions, mappings and source selection')
    convert.add_argument('-o','--output',required=True)
    check=sub.add_parser('validate')
    check.add_argument('package')
    discover=sub.add_parser('inspect')
    discover.add_argument('source')
    remap=sub.add_parser('configure',help='Change fields and types using only saved JSON; preserve source selection')
    remap.add_argument('package')
    remap.add_argument('--config',required=True)
    remap.add_argument('-o','--output',required=True)
    preview=sub.add_parser('dry-run',help='Offline MariaDB schema and binding preview; no database connection')
    preview.add_argument('package')
    preview.add_argument('-o','--output',required=True)
    args=parser.parse_args()
    try:
        if args.command=='inspect':
            print(json.dumps(inspect(args.source),ensure_ascii=False,indent=2))
            return
        if args.command=='dry-run':
            from .sql_preview import dry_run
            plan=dry_run(read_json(args.package))
            write_json(args.output,plan)
            print(f"Offline dry-run: {plan['counts']['approved_rows']} rows checked, {plan['counts']['errors']} errors; no database connection or execution.")
            return
        if args.command=='extract':
            p=extract(args.source,read_json(args.config) if args.config else None)
            write_json(args.output,p)
        elif args.command=='configure':
            p=configure_package(read_json(args.package),read_json(args.config))
            write_json(args.output,p)
        else:
            p=validate(read_json(args.package))
    except (ValueError,OSError,ValidationError) as exc:
        parser.exit(1,f'{exc}\n')
    blockers=sum(i['severity']=='error' and i['status']=='open' for i in p['issues'])
    print(f"Schema-valid ({p['schema_version']}): {len(p['records'])} candidates, {blockers} blockers; review status: {p['review_status']}")


if __name__=='__main__':
    main()
