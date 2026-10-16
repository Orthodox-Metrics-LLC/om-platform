-- Seed global default Certificate Studio templates and assets
-- Run after 20260614_certificate_studio.sql

INSERT IGNORE INTO certificate_studio_assets
  (id, name, category, scope, file_path, file_type, width, height, metadata_json, licensing_note, status)
VALUES
  (1, 'Orthodox Cross — Simple', 'cross', 'global', NULL, 'shape', 64, 64,
   '{"shape":"cross","color":"#c9a227"}', 'OM system asset', 'active'),
  (2, 'Gold Double Border', 'border', 'global', NULL, 'shape', NULL, NULL,
   '{"shape":"double_border","color":"#c9a227","padding":12}', 'OM system asset', 'active'),
  (3, 'Parchment Background', 'background', 'global', NULL, 'color', NULL, NULL,
   '{"fill":"#f7f3eb"}', 'OM system asset', 'active'),
  (4, 'Certificate Header — Classic', 'header', 'global', NULL, 'text', NULL, NULL,
   '{"text":"Certificate of Sacrament","font_family":"Times-Bold","font_size":28}', 'OM system asset', 'active'),
  (5, 'Times Roman', 'font', 'global', NULL, 'font', NULL, NULL,
   '{"internal_name":"Times-Roman","pdf_lib":"TimesRoman"}', 'PDF standard font — no license required', 'active'),
  (6, 'Helvetica', 'font', 'global', NULL, 'font', NULL, NULL,
   '{"internal_name":"Helvetica","pdf_lib":"Helvetica"}', 'PDF standard font — no license required', 'active');

-- Baptism default template
INSERT INTO certificate_studio_templates
  (id, church_id, certificate_type, name, description, status, is_default, canvas_size, orientation, created_by)
VALUES
  (1, NULL, 'baptism', 'OM Default — Baptism', 'Global default baptism certificate layout', 'active', TRUE, 'letter', 'landscape', NULL);

INSERT INTO certificate_studio_template_versions
  (id, template_id, version_number, layout_json, asset_manifest_json, font_manifest_json, published_at)
VALUES
  (1, 1, 1,
   JSON_OBJECT(
     'version', 1,
     'margins', JSON_OBJECT('top', 36, 'right', 36, 'bottom', 36, 'left', 36),
     'bleed', 0,
     'showGuides', true,
     'layers', JSON_ARRAY(
       JSON_OBJECT('id','bg1','type','background','name','Background','x',0,'y',0,'width',792,'height',612,'rotation',0,'opacity',1,'z_index',0,'locked',true,'visible',true,'style',JSON_OBJECT('fill','#f7f3eb'),'asset_id',3),
       JSON_OBJECT('id','border1','type','shape','name','Gold Border','x',24,'y',24,'width',744,'height',564,'rotation',0,'opacity',1,'z_index',1,'locked',false,'visible',true,'style',JSON_OBJECT('color','#c9a227','border_width',2)),
       JSON_OBJECT('id','title1','type','text','name','Title','x',96,'y',48,'width',600,'height',40,'rotation',0,'opacity',1,'z_index',2,'locked',false,'visible',true,'style',JSON_OBJECT('text','Certificate of Holy Baptism','font_family','Times-Bold','font_size',28,'color','#1a2744','alignment','center')),
       JSON_OBJECT('id','body1','type','text','name','Body Text','x',96,'y',120,'width',600,'height',80,'rotation',0,'opacity',1,'z_index',3,'locked',false,'visible',true,'style',JSON_OBJECT('text','This is to certify that','font_family','Times-Roman','font_size',16,'color','#333333','alignment','center')),
       JSON_OBJECT('id','name1','type','bound_field','name','Baptized Name','x',96,'y',200,'width',600,'height',48,'rotation',0,'opacity',1,'z_index',4,'locked',false,'visible',true,'style',JSON_OBJECT('font_family','Times-Bold','font_size',24,'color','#1a2744','alignment','center','text_transform','uppercase'),'binding',JSON_OBJECT('key','baptism.full_name','required',true)),
       JSON_OBJECT('id','date1','type','bound_field','name','Baptism Date','x',96,'y',280,'width',600,'height',32,'rotation',0,'opacity',1,'z_index',5,'locked',false,'visible',true,'style',JSON_OBJECT('font_family','Times-Roman','font_size',16,'color','#333333','alignment','center'),'binding',JSON_OBJECT('key','baptism.baptism_date','required',true)),
       JSON_OBJECT('id','church1','type','bound_field','name','Church Name','x',96,'y',380,'width',600,'height',32,'rotation',0,'opacity',1,'z_index',6,'locked',false,'visible',true,'style',JSON_OBJECT('font_family','Times-Roman','font_size',14,'color','#555555','alignment','center'),'binding',JSON_OBJECT('key','church.name','required',true)),
       JSON_OBJECT('id','clergy1','type','bound_field','name','Clergy','x',96,'y',480,'width',280,'height',32,'rotation',0,'opacity',1,'z_index',7,'locked',false,'visible',true,'style',JSON_OBJECT('font_family','Times-Italic','font_size',14,'color','#333333','alignment','left'),'binding',JSON_OBJECT('key','baptism.clergy_name','required',false))
     )
   ),
   JSON_ARRAY(3, 2),
   JSON_ARRAY('Times-Roman','Times-Bold','Times-Italic'),
   NOW());

UPDATE certificate_studio_templates SET current_version_id = 1 WHERE id = 1;

-- Marriage default
INSERT INTO certificate_studio_templates
  (id, church_id, certificate_type, name, description, status, is_default, canvas_size, orientation)
VALUES
  (2, NULL, 'marriage', 'OM Default — Marriage', 'Global default marriage certificate layout', 'active', TRUE, 'letter', 'landscape');

INSERT INTO certificate_studio_template_versions
  (id, template_id, version_number, layout_json, font_manifest_json, published_at)
VALUES
  (2, 2, 1,
   JSON_OBJECT(
     'version', 1,
     'margins', JSON_OBJECT('top', 36, 'right', 36, 'bottom', 36, 'left', 36),
     'layers', JSON_ARRAY(
       JSON_OBJECT('id','bg1','type','background','name','Background','x',0,'y',0,'width',792,'height',612,'z_index',0,'locked',true,'visible',true,'style',JSON_OBJECT('fill','#f7f3eb'),'asset_id',3),
       JSON_OBJECT('id','title1','type','text','name','Title','x',96,'y',48,'width',600,'height',40,'z_index',1,'visible',true,'style',JSON_OBJECT('text','Certificate of Holy Matrimony','font_family','Times-Bold','font_size',28,'color','#1a2744','alignment','center')),
       JSON_OBJECT('id','groom1','type','bound_field','name','Groom','x',96,'y',180,'width',600,'height',40,'z_index',2,'visible',true,'style',JSON_OBJECT('font_family','Times-Bold','font_size',22,'color','#1a2744','alignment','center'),'binding',JSON_OBJECT('key','marriage.groom_name','required',true)),
       JSON_OBJECT('id','and1','type','text','name','And','x',96,'y',230,'width',600,'height',24,'z_index',3,'visible',true,'style',JSON_OBJECT('text','and','font_family','Times-Italic','font_size',16,'alignment','center')),
       JSON_OBJECT('id','bride1','type','bound_field','name','Bride','x',96,'y',260,'width',600,'height',40,'z_index',4,'visible',true,'style',JSON_OBJECT('font_family','Times-Bold','font_size',22,'color','#1a2744','alignment','center'),'binding',JSON_OBJECT('key','marriage.bride_name','required',true)),
       JSON_OBJECT('id','date1','type','bound_field','name','Marriage Date','x',96,'y',340,'width',600,'height',32,'z_index',5,'visible',true,'style',JSON_OBJECT('font_family','Times-Roman','font_size',16,'alignment','center'),'binding',JSON_OBJECT('key','marriage.marriage_date','required',true)),
       JSON_OBJECT('id','church1','type','bound_field','name','Church','x',96,'y',420,'width',600,'height',32,'z_index',6,'visible',true,'style',JSON_OBJECT('font_family','Times-Roman','font_size',14,'alignment','center'),'binding',JSON_OBJECT('key','church.name','required',true))
     )
   ),
   JSON_ARRAY('Times-Roman','Times-Bold'),
   NOW());

UPDATE certificate_studio_templates SET current_version_id = 2 WHERE id = 2;

-- Reception default
INSERT INTO certificate_studio_templates
  (id, church_id, certificate_type, name, description, status, is_default, canvas_size, orientation)
VALUES
  (3, NULL, 'reception', 'OM Default — Reception', 'Global default reception certificate layout', 'active', TRUE, 'letter', 'landscape');

INSERT INTO certificate_studio_template_versions
  (id, template_id, version_number, layout_json, font_manifest_json, published_at)
VALUES
  (3, 3, 1,
   JSON_OBJECT(
     'version', 1,
     'margins', JSON_OBJECT('top', 36, 'right', 36, 'bottom', 36, 'left', 36),
     'layers', JSON_ARRAY(
       JSON_OBJECT('id','bg1','type','background','name','Background','x',0,'y',0,'width',792,'height',612,'z_index',0,'locked',true,'visible',true,'style',JSON_OBJECT('fill','#f7f3eb'),'asset_id',3),
       JSON_OBJECT('id','title1','type','text','name','Title','x',96,'y',48,'width',600,'height',40,'z_index',1,'visible',true,'style',JSON_OBJECT('text','Certificate of Reception','font_family','Times-Bold','font_size',28,'color','#1a2744','alignment','center')),
       JSON_OBJECT('id','name1','type','bound_field','name','Person Name','x',96,'y',200,'width',600,'height',48,'z_index',2,'visible',true,'style',JSON_OBJECT('font_family','Times-Bold','font_size',24,'alignment','center'),'binding',JSON_OBJECT('key','reception.person_name','required',true)),
       JSON_OBJECT('id','date1','type','bound_field','name','Reception Date','x',96,'y',280,'width',600,'height',32,'z_index',3,'visible',true,'style',JSON_OBJECT('font_family','Times-Roman','font_size',16,'alignment','center'),'binding',JSON_OBJECT('key','reception.reception_date','required',true)),
       JSON_OBJECT('id','church1','type','bound_field','name','Church','x',96,'y',380,'width',600,'height',32,'z_index',4,'visible',true,'style',JSON_OBJECT('font_family','Times-Roman','font_size',14,'alignment','center'),'binding',JSON_OBJECT('key','church.name','required',true))
     )
   ),
   JSON_ARRAY('Times-Roman','Times-Bold'),
   NOW());

UPDATE certificate_studio_templates SET current_version_id = 3 WHERE id = 3;
